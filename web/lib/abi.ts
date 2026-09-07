export const SAKU_REGISTRY_ABI = [{"inputs":[{"internalType":"address","name":"_usdcAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"AlreadyRegistered","type":"error"},{"inputs":[],"name":"AmplopExpired","type":"error"},{"inputs":[],"name":"AmplopNotExpired","type":"error"},{"inputs":[],"name":"AmplopNotFound","type":"error"},{"inputs":[],"name":"InsufficientAllowance","type":"error"},{"inputs":[],"name":"InsufficientBalance","type":"error"},{"inputs":[],"name":"InvalidAddress","type":"error"},{"inputs":[],"name":"InvalidAmount","type":"error"},{"inputs":[],"name":"NotCreator","type":"error"},{"inputs":[],"name":"NotRegistered","type":"error"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"OwnableInvalidOwner","type":"error"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"OwnableUnauthorizedAccount","type":"error"},{"inputs":[],"name":"ReentrancyGuardReentrantCall","type":"error"},{"inputs":[],"name":"TransferFailed","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"amplopId","type":"bytes32"},{"indexed":true,"internalType":"address","name":"claimer","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"AmplopClaimed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"amplopId","type":"bytes32"},{"indexed":true,"internalType":"address","name":"creator","type":"address"},{"indexed":false,"internalType":"uint256","name":"totalAmount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"maxWinners","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"expiry","type":"uint256"}],"name":"AmplopCreated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"amplopId","type":"bytes32"},{"indexed":true,"internalType":"address","name":"creator","type":"address"},{"indexed":false,"internalType":"uint256","name":"remainingAmount","type":"uint256"}],"name":"AmplopRefunded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"phoneHash","type":"bytes32"},{"indexed":false,"internalType":"address","name":"account","type":"address"},{"indexed":false,"internalType":"uint256","name":"timestamp","type":"uint256"}],"name":"Registered","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"phoneHash","type":"bytes32"},{"indexed":true,"internalType":"address","name":"recipient","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"RegistrationBonusSent","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"phoneHash","type":"bytes32"},{"indexed":true,"internalType":"address","name":"wallet","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"ToppedUp","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"receiverHash","type":"bytes32"},{"indexed":false,"internalType":"address","name":"sender","type":"address"},{"indexed":false,"internalType":"address","name":"receiver","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Transferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"phoneHash","type":"bytes32"},{"indexed":true,"internalType":"address","name":"wallet","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"fee","type":"uint256"}],"name":"Withdrawn","type":"event"},{"stateMutability":"payable","type":"fallback"},{"inputs":[],"name":"AMPLOP_EXPIRY","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"REGISTRATION_BONUS","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"WITHDRAW_FEE_BPS","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"amplopClaimedAmounts","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"amplopCreators","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"amplopExists","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"amplopExpiry","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"amplopTotalAmounts","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32[]","name":"receiverHashes","type":"bytes32[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"name":"batchTransfer","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"amplopId","type":"bytes32"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"claimAmplop","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"amplopId","type":"bytes32"},{"internalType":"uint256","name":"maxWinners","type":"uint256"},{"internalType":"uint256","name":"totalAmount","type":"uint256"}],"name":"createAmplop","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"depositETH","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"emergencyWithdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"phoneHash","type":"bytes32"}],"name":"getAccount","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"amplopId","type":"bytes32"}],"name":"getAmplopRemaining","outputs":[{"internalType":"uint256","name":"remaining","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getContractETHBalance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"phoneHash","type":"bytes32"}],"name":"isRegistered","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"phoneToAccount","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"amplopId","type":"bytes32"}],"name":"refundAmplop","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"phoneHash","type":"bytes32"},{"internalType":"address","name":"walletAddress","type":"address"}],"name":"register","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"registrationTime","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"receiverHash","type":"bytes32"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferUSDC","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"receiver","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferUSDCDirect","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"usdcToken","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"toAddress","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"withdrawETH","outputs":[],"stateMutability":"nonpayable","type":"function"},{"stateMutability":"payable","type":"receive"}] as const;

export const IDRX_ABI = [
  {
    "inputs": [],
    "name": "name",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "address", "name": "to", "type": "address"},
      {"internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "transfer",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "address", "name": "spender", "type": "address"},
      {"internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "approve",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "address", "name": "from", "type": "address"},
      {"internalType": "address", "name": "to", "type": "address"},
      {"internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "transferFrom",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "address", "name": "owner", "type": "address"},
      {"internalType": "address", "name": "spender", "type": "address"}
    ],
    "name": "allowance",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// ============================================================
// USDC STAKING ABI (Liquid Staking)
// ============================================================
export const USDC_STAKING_ABI = [
  // Events
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "Staked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "Unstaked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}
    ],
    "name": "RewardsClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"},
      {"indexed": false, "internalType": "uint256", "name": "duration", "type": "uint256"}
    ],
    "name": "RewardPoolAdded",
    "type": "event"
  },
  // View functions
  {
    "inputs": [],
    "name": "usdcToken",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalStaked",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "accRewardPerShare",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lastRewardTime",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rewardRate",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rewardEndTime",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_STAKE_AMOUNT",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "userRewardDebt",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "userStakedAmount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
    "name": "getPendingRewards",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
    "name": "getUserInfo",
    "outputs": [
      {"internalType": "uint256", "name": "staked", "type": "uint256"},
      {"internalType": "uint256", "name": "share", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Write functions
  {
    "inputs": [{"internalType": "uint256", "name": "_amount", "type": "uint256"}],
    "name": "stake",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "_amount", "type": "uint256"}],
    "name": "unstake",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unstakeAll",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimRewards",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "compoundRewards",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

// stUSDC Token ABI (for balance queries)
export const ST_USDC_ABI = [
  {
    "inputs": [],
    "name": "name",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
