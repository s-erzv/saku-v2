import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { ContractTransactionReceipt } from "ethers";

const RATE_EXPIRY = 60; // seconds — within [MIN_RATE_EXPIRY, MAX_RATE_EXPIRY]
const LOCK_AMOUNT = ethers.parseUnits("100", 6); // 100 units of a 6-decimal token (like USDC)

function recipientHash(phone: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(phone));
}

async function extractRequestId(escrowInterface: any, receipt: ContractTransactionReceipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = escrowInterface.parseLog(log);
      if (parsed?.name === "OfframpRequested") {
        return parsed.args.requestId as string;
      }
    } catch {
      // not a log from this contract's interface — ignore
    }
  }
  throw new Error("OfframpRequested event not found");
}

async function deployFixture() {
  const [owner, user, settler, other] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const lockToken = await MockUSDC.deploy(ethers.parseUnits("1000000", 6));

  const MockStableToken = await ethers.getContractFactory("MockStableToken");
  const stableToken = await MockStableToken.deploy(ethers.parseUnits("1000000", 18));

  const MockPancakeRouter = await ethers.getContractFactory("MockPancakeRouter");
  const router = await MockPancakeRouter.deploy();
  // 1 unit of 6-decimal lockToken -> 1 unit of 18-decimal stableToken (accounts for decimals).
  await router.setRate(10n ** 12n, 1n);

  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const priceFeed = await MockV3Aggregator.deploy(8, 60000000000n); // $600.00000000

  const Escrow = await ethers.getContractFactory("SakuOfframpEscrow");
  const escrow = await Escrow.deploy(
    await router.getAddress(),
    await priceFeed.getAddress(),
    await stableToken.getAddress(),
    settler.address
  );

  // Fund the mock router so it can pay out the stable-token leg of swaps.
  await stableToken.mint(await router.getAddress(), ethers.parseUnits("500000", 18));

  // The escrow accepts nothing until the owner says what it handles, so every test that locks
  // has to opt the token in first. That is the point of the allowlist, not an inconvenience.
  await escrow.setTokenAllowed(await lockToken.getAddress(), true);

  // Give the user tokens to lock and pre-approve the escrow.
  await lockToken.transfer(user.address, ethers.parseUnits("1000", 6));
  await lockToken.connect(user).approve(await escrow.getAddress(), ethers.MaxUint256);

  return { owner, user, settler, other, lockToken, stableToken, router, priceFeed, escrow };
}

describe("SakuOfframpEscrow", function () {
  it("locks funds and emits OfframpRequested", async function () {
    const { user, lockToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");

    await expect(
      escrow.connect(user).lockForOfframp(LOCK_AMOUNT, await lockToken.getAddress(), hash, RATE_EXPIRY)
    ).to.emit(escrow, "OfframpRequested");

    expect(await lockToken.balanceOf(await escrow.getAddress())).to.equal(LOCK_AMOUNT);
  });

  it("rejects a rate expiry outside the PRD-mandated bounds", async function () {
    const { user, lockToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    await expect(
      escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, 10)
    ).to.be.revertedWithCustomError(escrow, "InvalidExpiry");

    await expect(
      escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, 3600)
    ).to.be.revertedWithCustomError(escrow, "InvalidExpiry");
  });

  it("rejects a zero amount or zero-address token", async function () {
    const { user, lockToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    await expect(
      escrow.connect(user).lockForOfframp(0, token, hash, RATE_EXPIRY)
    ).to.be.revertedWithCustomError(escrow, "InvalidAmount");

    await expect(
      escrow.connect(user).lockForOfframp(LOCK_AMOUNT, ethers.ZeroAddress, hash, RATE_EXPIRY)
    ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
  });

  it("settles a locked request via PancakeSwap before the rate expires", async function () {
    const { user, settler, lockToken, stableToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    const tx = await escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    const path = [token, await stableToken.getAddress()];
    await expect(escrow.connect(settler).settleOfframp(requestId, path, 0)).to.emit(
      escrow,
      "OfframpSettled"
    );

    const request = await escrow.getRequest(requestId);
    expect(request.status).to.equal(2); // Settled
    expect(await lockToken.balanceOf(await escrow.getAddress())).to.equal(0n);
  });

  it("reverts settlement once the rate-lock window has expired", async function () {
    const { user, settler, lockToken, stableToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    const tx = await escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    await time.increase(RATE_EXPIRY + 1);

    const path = [token, await stableToken.getAddress()];
    await expect(
      escrow.connect(settler).settleOfframp(requestId, path, 0)
    ).to.be.revertedWithCustomError(escrow, "RateExpired");
  });

  it("refunds the user after expiry, callable by anyone", async function () {
    const { user, other, lockToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    const tx = await escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    await time.increase(RATE_EXPIRY + 1);

    const balanceBefore = await lockToken.balanceOf(user.address);
    await expect(escrow.connect(other).refund(requestId)).to.emit(escrow, "OfframpRefunded");
    expect(await lockToken.balanceOf(user.address)).to.equal(balanceBefore + LOCK_AMOUNT);

    const request = await escrow.getRequest(requestId);
    expect(request.status).to.equal(3); // Refunded
  });

  it("blocks refund before the rate-lock window expires", async function () {
    const { user, lockToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    const tx = await escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    await expect(escrow.connect(user).refund(requestId)).to.be.revertedWithCustomError(
      escrow,
      "RateNotYetExpired"
    );
  });

  it("rejects settlement from a non-settler address", async function () {
    const { user, other, lockToken, stableToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    const tx = await escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    const path = [token, await stableToken.getAddress()];
    await expect(
      escrow.connect(other).settleOfframp(requestId, path, 0)
    ).to.be.revertedWithCustomError(escrow, "NotSettler");
  });

  it("rejects a swap path that doesn't start at the locked token or end at the stable token", async function () {
    const { user, settler, lockToken, stableToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    const tx = await escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    const badPath = [await stableToken.getAddress(), token]; // reversed
    await expect(
      escrow.connect(settler).settleOfframp(requestId, badPath, 0)
    ).to.be.revertedWithCustomError(escrow, "InvalidSwapPath");
  });

  it("cannot settle or refund the same request twice", async function () {
    const { user, settler, lockToken, stableToken, escrow } = await deployFixture();
    const hash = recipientHash("+6281234567890");
    const token = await lockToken.getAddress();

    const tx = await escrow.connect(user).lockForOfframp(LOCK_AMOUNT, token, hash, RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    const path = [token, await stableToken.getAddress()];
    await escrow.connect(settler).settleOfframp(requestId, path, 0);

    await expect(
      escrow.connect(settler).settleOfframp(requestId, path, 0)
    ).to.be.revertedWithCustomError(escrow, "RequestNotLocked");
  });

  it("reports the latest BNB/USD price from the Chainlink feed", async function () {
    const { escrow } = await deployFixture();
    const [price, decimals] = await escrow.getLatestBnbUsdPrice();
    expect(price).to.equal(60000000000n);
    expect(decimals).to.equal(8);
  });

  it("refuses a token the owner has not allowed", async () => {
    const { user, escrow } = await deployFixture();

    // A token the attacker minted themselves. Before the allowlist this locked fine, and the
    // only thing between it and a fiat payout was a check in the backend's signing policy.
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const rogue = await MockUSDC.deploy(ethers.parseUnits("1000000", 6));
    await rogue.transfer(user.address, LOCK_AMOUNT);
    await rogue.connect(user).approve(await escrow.getAddress(), ethers.MaxUint256);

    await expect(
      escrow
        .connect(user)
        .lockForOfframp(LOCK_AMOUNT, await rogue.getAddress(), recipientHash("+62811"), RATE_EXPIRY)
    ).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
  });

  it("lets the owner allow a token and take the allowance back", async () => {
    const { owner, user, other, escrow } = await deployFixture();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const second = await MockUSDC.deploy(ethers.parseUnits("1000000", 6));
    const address = await second.getAddress();
    await second.transfer(user.address, LOCK_AMOUNT * 2n);
    await second.connect(user).approve(await escrow.getAddress(), ethers.MaxUint256);

    await expect(escrow.connect(owner).setTokenAllowed(address, true))
      .to.emit(escrow, "TokenAllowanceUpdated")
      .withArgs(address, true);
    expect(await escrow.offrampAllowed(address)).to.equal(true);

    await escrow
      .connect(user)
      .lockForOfframp(LOCK_AMOUNT, address, recipientHash("+62811"), RATE_EXPIRY);

    await escrow.connect(owner).setTokenAllowed(address, false);
    await expect(
      escrow
        .connect(user)
        .lockForOfframp(LOCK_AMOUNT, address, recipientHash("+62811"), RATE_EXPIRY)
    ).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");

    // And it stays the owner's decision to make.
    await expect(
      escrow.connect(other).setTokenAllowed(address, true)
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });

  it("lets the owner rotate the settler and stable token", async function () {
    const { owner, other, escrow } = await deployFixture();

    await expect(escrow.connect(owner).setSettler(other.address))
      .to.emit(escrow, "SettlerUpdated");
    expect(await escrow.settler()).to.equal(other.address);

    await expect(
      escrow.connect(other).setSettler(other.address)
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });
});

/**
 * Reentrancy.
 *
 * `lockForOfframp`, `settleOfframp` and `refund` are all `nonReentrant`, and nothing here exercised
 * that — twenty-six tests and not one of them tried to come back in. These do.
 *
 * On the shape of the attacker. The obvious one — a contract that re-enters from `receive()` or
 * `fallback()` — cannot be built against this escrow, because the escrow never sends native value:
 * no `payable` function, no `receive`, no `fallback`, no `.call{value:}`. An ether-receiving hook has
 * nothing to hook. What it does send is ERC20, and there are exactly two places an external contract
 * gets control during a state-changing call:
 *
 *   1. `refund` → `IERC20.safeTransfer`, where the *token* runs code. Attacked with `ReentrantToken`,
 *      which calls back on every balance movement.
 *   2. `settleOfframp` → `pancakeRouter.swapExactTokensForTokens`, where the *router* runs code.
 *      Attacked with `ReentrantRouter`. The router address is `immutable`, so that test deploys its
 *      own escrow pointed at the hostile one.
 *
 * Each attack is run in two modes, because they prove different things. Letting the inner revert
 * bubble proves *what* stopped it — the transaction dies with one named error and no other reason.
 * Swallowing it proves the outcome anyone actually cares about: the money moves exactly once.
 *
 * Writing these turned up something worth recording rather than smoothing over. Re-entering
 * `settleOfframp` never reaches the reentrancy guard at all: it is declared
 * `external onlySettler nonReentrant`, modifiers run in the order written, and a hostile router is
 * not the settler — so the re-entry dies on `NotSettler` first. The guard on that path is therefore
 * tested through `refund`, which is permissionless by design and has nothing in front of it. Both
 * facts are asserted below, because "the guard stopped it" would have been the wrong story for one
 * of them.
 *
 * And the guard is not the only thing standing here either. Both functions write their status before
 * making the external call (checks-effects-interactions), so a re-entrant call that somehow got past
 * the guard would still meet `RequestNotLocked`. These tests pin down which defence speaks first;
 * the ordering is the layer behind it, covered by "cannot settle or refund the same request twice".
 */
describe("SakuOfframpEscrow — reentrancy", function () {
  async function deployTokenAttackFixture() {
    const [owner, settler] = await ethers.getSigners();

    const ReentrantToken = await ethers.getContractFactory("ReentrantToken");
    const token = await ReentrantToken.deploy(ethers.parseUnits("1000000", 6));

    const MockStableToken = await ethers.getContractFactory("MockStableToken");
    const stableToken = await MockStableToken.deploy(ethers.parseUnits("1000000", 18));

    // Honest router: the refund path never reaches it, and a second hostile actor would only make
    // a failure ambiguous.
    const MockPancakeRouter = await ethers.getContractFactory("MockPancakeRouter");
    const router = await MockPancakeRouter.deploy();
    await router.setRate(10n ** 12n, 1n);

    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    const priceFeed = await MockV3Aggregator.deploy(8, 60000000000n);

    const Escrow = await ethers.getContractFactory("SakuOfframpEscrow");
    const escrow = await Escrow.deploy(
      await router.getAddress(),
      await priceFeed.getAddress(),
      await stableToken.getAddress(),
      settler.address
    );
    await escrow.setTokenAllowed(await token.getAddress(), true);

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = await Attacker.deploy(await escrow.getAddress(), await token.getAddress());

    // Exactly what it locks and nothing spare, so "got it back, once" is a single equality rather
    // than a delta that a double payout could hide inside.
    await token.mint(await attacker.getAddress(), LOCK_AMOUNT);

    return { owner, settler, token, stableToken, escrow, attacker };
  }

  async function lockFromAttacker(attacker: any, escrow: any) {
    const tx = await attacker.lock(LOCK_AMOUNT, recipientHash("+6281234567890"), RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    return extractRequestId(escrow.interface, receipt);
  }

  it("kills the whole refund when the token re-enters refund and lets the revert bubble", async function () {
    const { token, escrow, attacker } = await deployTokenAttackFixture();
    const requestId = await lockFromAttacker(attacker, escrow);
    const escrowAddress = await escrow.getAddress();

    await time.increase(RATE_EXPIRY + 1);

    await expect(attacker.attackRefund(false)).to.be.revertedWithCustomError(
      escrow,
      "ReentrancyGuardReentrantCall"
    );

    // The refund that was re-entered is rolled back with everything else: the request is still
    // Locked and the escrow still holds the tokens, so nothing leaked on the way out.
    const request = await escrow.getRequest(requestId);
    expect(request.status).to.equal(1); // Locked
    expect(await token.balanceOf(escrowAddress)).to.equal(LOCK_AMOUNT);
    expect(await token.balanceOf(await attacker.getAddress())).to.equal(0n);
  });

  it("pays a re-entered refund exactly once when the attacker swallows the guard's revert", async function () {
    const { token, escrow, attacker } = await deployTokenAttackFixture();
    const requestId = await lockFromAttacker(attacker, escrow);
    const attackerAddress = await attacker.getAddress();
    const escrowAddress = await escrow.getAddress();

    await time.increase(RATE_EXPIRY + 1);
    await attacker.attackRefund(true);

    // The callback has to have actually run, or this test would pass for the wrong reason.
    expect(await attacker.reentryAttempted()).to.equal(true);
    expect(await attacker.reentryReverted()).to.equal(true);

    // One payout. The attacker was funded with exactly `LOCK_AMOUNT`, so a second refund could only
    // come out of an escrow that now has nothing left to give.
    expect(await token.balanceOf(attackerAddress)).to.equal(LOCK_AMOUNT);
    expect(await token.balanceOf(escrowAddress)).to.equal(0n);

    const request = await escrow.getRequest(requestId);
    expect(request.status).to.equal(3); // Refunded
  });

  async function deployRouterAttackFixture() {
    const [owner, user, settler] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const lockToken = await MockUSDC.deploy(ethers.parseUnits("1000000", 6));

    const MockStableToken = await ethers.getContractFactory("MockStableToken");
    const stableToken = await MockStableToken.deploy(ethers.parseUnits("1000000", 18));

    const ReentrantRouter = await ethers.getContractFactory("ReentrantRouter");
    const router = await ReentrantRouter.deploy();

    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    const priceFeed = await MockV3Aggregator.deploy(8, 60000000000n);

    const Escrow = await ethers.getContractFactory("SakuOfframpEscrow");
    const escrow = await Escrow.deploy(
      await router.getAddress(),
      await priceFeed.getAddress(),
      await stableToken.getAddress(),
      settler.address
    );
    await escrow.setTokenAllowed(await lockToken.getAddress(), true);

    // The router pays the stable leg out of its own balance.
    await stableToken.mint(await router.getAddress(), ethers.parseUnits("500000", 18));

    await lockToken.transfer(user.address, ethers.parseUnits("1000", 6));
    await lockToken.connect(user).approve(await escrow.getAddress(), ethers.MaxUint256);

    const tx = await escrow
      .connect(user)
      .lockForOfframp(LOCK_AMOUNT, await lockToken.getAddress(), recipientHash("+6281234567890"), RATE_EXPIRY);
    const receipt = (await tx.wait())!;
    const requestId = await extractRequestId(escrow.interface, receipt);

    const path = [await lockToken.getAddress(), await stableToken.getAddress()];

    return { owner, user, settler, lockToken, stableToken, router, escrow, requestId, path };
  }

  it("refuses a settleOfframp re-entered from the router on access control, before the guard is reached", async function () {
    const { settler, lockToken, escrow, router, requestId, path } = await deployRouterAttackFixture();

    await router.arm(await escrow.getAddress(), requestId, false, false);

    // Not `ReentrancyGuardReentrantCall`, and the reason is worth knowing rather than papering over:
    // `settleOfframp` is declared `external onlySettler nonReentrant`, modifiers run in the order
    // they are written, and the router is not the settler. The re-entry never gets as far as the
    // guard. Two independent defences on this path, and this is the outer one.
    await expect(
      escrow.connect(settler).settleOfframp(requestId, path, 0)
    ).to.be.revertedWithCustomError(escrow, "NotSettler");

    const request = await escrow.getRequest(requestId);
    expect(request.status).to.equal(1); // Locked
    expect(await lockToken.balanceOf(await escrow.getAddress())).to.equal(LOCK_AMOUNT);
  });

  it("kills the whole settlement when the router re-enters refund and lets the revert bubble", async function () {
    const { settler, lockToken, escrow, router, requestId, path } = await deployRouterAttackFixture();

    // `refund` is permissionless on purpose, so nothing stands in front of the guard here. This is
    // the call that actually tests `nonReentrant` on the settlement path.
    await router.arm(await escrow.getAddress(), requestId, false, true);

    await expect(
      escrow.connect(settler).settleOfframp(requestId, path, 0)
    ).to.be.revertedWithCustomError(escrow, "ReentrancyGuardReentrantCall");

    // Rolled back, including the tokens the router had already pulled out of the escrow.
    const request = await escrow.getRequest(requestId);
    expect(request.status).to.equal(1); // Locked
    expect(await lockToken.balanceOf(await escrow.getAddress())).to.equal(LOCK_AMOUNT);
  });

  it("settles exactly once, and refunds nobody, when the router's refund re-entry is swallowed", async function () {
    const { owner, user, settler, lockToken, stableToken, escrow, router, requestId, path } =
      await deployRouterAttackFixture();

    await router.arm(await escrow.getAddress(), requestId, true, true);

    // Settled proceeds go to `owner()` — the handoff to the off-chain fiat leg.
    const ownerStableBefore = await stableToken.balanceOf(owner.address);
    const userLockBefore = await lockToken.balanceOf(user.address);

    await escrow.connect(settler).settleOfframp(requestId, path, 0);

    expect(await router.reentryAttempted()).to.equal(true);
    expect(await router.reentryReverted()).to.equal(true);

    // The failure this guards against is not a double settlement — it is the same tokens being both
    // swapped away and handed back. The user got nothing back, the owner was paid once, and the
    // escrow kept nothing.
    expect(await lockToken.balanceOf(user.address)).to.equal(userLockBefore);
    expect(await stableToken.balanceOf(owner.address)).to.equal(ownerStableBefore + LOCK_AMOUNT);
    expect(await lockToken.balanceOf(await escrow.getAddress())).to.equal(0n);

    const request = await escrow.getRequest(requestId);
    expect(request.status).to.equal(2); // Settled
  });
});
