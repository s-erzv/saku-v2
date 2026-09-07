// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IPancakeRouter02.sol";
import "./interfaces/IChainlinkAggregatorV3.sol";

/// @title SakuOfframpEscrow
/// @notice Lock & Release escrow for Saku's cross-rail offramp transfers on BNB Smart Chain
///         (PRD Saku v2, Section 5). A user locks a token, the rate is held for a short
///         window, an authorized settler swaps it into a stable token via PancakeSwap once
///         the off-chain fiat leg is ready, and anyone can refund the request if settlement
///         doesn't happen before the rate-lock expires.
/// @dev This is Lock & Release, not Burn & Mint (PRD Section 5.2): tokens are held in escrow
///      and actually swapped on-chain, never burned/minted as an internal representation.
///      Trust boundary note (PRD Section 5.3): once a request is Settled, the swapped stable
///      tokens are handed to `owner()` for the off-chain fiat conversion/disbursement leg
///      (mocked in the hackathon build). This contract is non-custodial up to that point, but
///      the fiat conversion step is NOT trustless — that dependency is explicit, not hidden.
contract SakuOfframpEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Locked,
        Settled,
        Refunded
    }

    struct OfframpRequest {
        address user;
        address token;
        uint256 amount;
        bytes32 recipientPhoneHash;
        uint256 deadline;
        Status status;
    }

    // ============================================================
    // STATE
    // ============================================================

    IPancakeRouter02 public immutable pancakeRouter;
    IChainlinkAggregatorV3 public immutable bnbUsdPriceFeed;

    /// @notice Backend relayer authorized to call `settleOfframp` once it observes
    ///         `OfframpRequested` and the off-chain rate/fiat leg is ready (PRD Section 5.1, step 5).
    address public settler;

    /// @notice Stable token requests are swapped into on settlement (e.g. a BUSD-pegged
    ///         testnet token). Owner-adjustable in case the testnet liquidity pair changes.
    address public stableToken;

    mapping(bytes32 => OfframpRequest) public requests;
    uint256 private _nonce;

    /// @dev PRD Section 5.1 step 4: "rate dikunci dengan expiry singkat (30-60 detik)".
    ///      Bounds are widened slightly (up to 120s) to leave headroom for real network/UX
    ///      latency without abandoning the "short expiry" intent.
    uint256 public constant MIN_RATE_EXPIRY = 30 seconds;
    uint256 public constant MAX_RATE_EXPIRY = 120 seconds;

    // ============================================================
    // EVENTS
    // ============================================================

    event OfframpRequested(
        address indexed user,
        uint256 amount,
        address indexed token,
        bytes32 indexed recipientHash,
        bytes32 requestId,
        uint256 deadline
    );
    event OfframpSettled(bytes32 indexed requestId, uint256 amountIn, uint256 amountOut);
    event OfframpRefunded(bytes32 indexed requestId, address indexed user, uint256 amount);
    event SettlerUpdated(address indexed oldSettler, address indexed newSettler);
    event StableTokenUpdated(address indexed oldToken, address indexed newToken);

    // ============================================================
    // ERRORS
    // ============================================================

    error InvalidAddress();
    error InvalidAmount();
    error InvalidExpiry();
    error RequestNotFound();
    error RequestNotLocked();
    error RateExpired();
    error RateNotYetExpired();
    error NotSettler();
    error InvalidSwapPath();

    // ============================================================
    // MODIFIERS
    // ============================================================

    modifier onlySettler() {
        if (msg.sender != settler) revert NotSettler();
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(
        address _pancakeRouter,
        address _bnbUsdPriceFeed,
        address _stableToken,
        address _settler
    ) Ownable(msg.sender) {
        if (
            _pancakeRouter == address(0) ||
            _bnbUsdPriceFeed == address(0) ||
            _stableToken == address(0) ||
            _settler == address(0)
        ) revert InvalidAddress();

        pancakeRouter = IPancakeRouter02(_pancakeRouter);
        bnbUsdPriceFeed = IChainlinkAggregatorV3(_bnbUsdPriceFeed);
        stableToken = _stableToken;
        settler = _settler;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    /// @notice Latest BNB/USD rate from Chainlink (PRD Section 5.1, step 2).
    /// @return price Raw answer, scaled by `decimals`.
    /// @return decimals Number of decimals `price` is scaled by.
    /// @return updatedAt Timestamp the round was last updated.
    function getLatestBnbUsdPrice()
        external
        view
        returns (int256 price, uint8 decimals, uint256 updatedAt)
    {
        (, int256 answer, , uint256 ts, ) = bnbUsdPriceFeed.latestRoundData();
        return (answer, bnbUsdPriceFeed.decimals(), ts);
    }

    function getRequest(bytes32 requestId) external view returns (OfframpRequest memory) {
        return requests[requestId];
    }

    // ============================================================
    // CORE FLOW
    // ============================================================

    /// @notice Lock funds for a cross-rail offramp transfer (PRD Section 5.1, step 4).
    /// @dev Caller must have approved this contract for at least `amount` of `token`.
    /// @param amount Amount of `token` to lock.
    /// @param token ERC20 token being sent by the user.
    /// @param recipientPhoneHash keccak256 hash of the recipient's phone number — never the
    ///        plain-text number itself (PRD Section 1: closing the plain-text-PII gap from v1).
    /// @param rateExpiry Seconds the locked rate stays valid for; must be within
    ///        [MIN_RATE_EXPIRY, MAX_RATE_EXPIRY].
    function lockForOfframp(
        uint256 amount,
        address token,
        bytes32 recipientPhoneHash,
        uint256 rateExpiry
    ) external nonReentrant returns (bytes32 requestId) {
        if (token == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (rateExpiry < MIN_RATE_EXPIRY || rateExpiry > MAX_RATE_EXPIRY) revert InvalidExpiry();

        requestId = keccak256(
            abi.encodePacked(msg.sender, token, amount, recipientPhoneHash, block.timestamp, _nonce++)
        );

        uint256 deadline = block.timestamp + rateExpiry;

        requests[requestId] = OfframpRequest({
            user: msg.sender,
            token: token,
            amount: amount,
            recipientPhoneHash: recipientPhoneHash,
            deadline: deadline,
            status: Status.Locked
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit OfframpRequested(msg.sender, amount, token, recipientPhoneHash, requestId, deadline);
    }

    /// @notice Settle a locked request by swapping the locked token into `stableToken` via
    ///         PancakeSwap (PRD Section 5.1, step 6). Proceeds go to `owner()`, which hands
    ///         them off for the (simulated) fiat conversion + disbursement legs.
    /// @dev Status flips to Settled before the external swap call (checks-effects-interactions,
    ///      PRD Section 5.3). If the rate-lock window has passed, this reverts and the request
    ///      stays Locked so `refund` can unlock it instead — matching "transaksi revert -> dana
    ///      otomatis unlock (refund)" in PRD Section 5.1, step 6.
    function settleOfframp(
        bytes32 requestId,
        address[] calldata path,
        uint256 minAmountOut
    ) external onlySettler nonReentrant returns (uint256 amountOut) {
        OfframpRequest storage req = requests[requestId];
        if (req.status == Status.None) revert RequestNotFound();
        if (req.status != Status.Locked) revert RequestNotLocked();
        if (block.timestamp > req.deadline) revert RateExpired();
        if (path.length < 2 || path[0] != req.token || path[path.length - 1] != stableToken) {
            revert InvalidSwapPath();
        }

        uint256 amount = req.amount;
        req.status = Status.Settled;

        IERC20(req.token).forceApprove(address(pancakeRouter), amount);
        uint256[] memory amounts = pancakeRouter.swapExactTokensForTokens(
            amount,
            minAmountOut,
            path,
            owner(),
            block.timestamp
        );
        amountOut = amounts[amounts.length - 1];

        emit OfframpSettled(requestId, amount, amountOut);
    }

    /// @notice Refund a locked request whose rate-lock window expired before settlement.
    ///         Callable by anyone, including the original user (PRD Section 5.3 — state-desync
    ///         mitigation: "fungsi refund() yang bisa dipanggil siapa pun").
    function refund(bytes32 requestId) external nonReentrant {
        OfframpRequest storage req = requests[requestId];
        if (req.status == Status.None) revert RequestNotFound();
        if (req.status != Status.Locked) revert RequestNotLocked();
        if (block.timestamp <= req.deadline) revert RateNotYetExpired();

        uint256 amount = req.amount;
        address user = req.user;
        address token = req.token;
        req.status = Status.Refunded;

        IERC20(token).safeTransfer(user, amount);

        emit OfframpRefunded(requestId, user, amount);
    }

    // ============================================================
    // ADMIN FUNCTIONS
    // ============================================================

    function setSettler(address newSettler) external onlyOwner {
        if (newSettler == address(0)) revert InvalidAddress();
        emit SettlerUpdated(settler, newSettler);
        settler = newSettler;
    }

    function setStableToken(address newStableToken) external onlyOwner {
        if (newStableToken == address(0)) revert InvalidAddress();
        emit StableTokenUpdated(stableToken, newStableToken);
        stableToken = newStableToken;
    }
}
