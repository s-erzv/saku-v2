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
