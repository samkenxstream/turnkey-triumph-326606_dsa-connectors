const { expect } = require("chai");
const hre = require("hardhat");
const { web3, deployments, waffle, ethers } = hre;
const { provider, deployContract } = waffle

const deployAndEnableConnector = require("../../scripts/deployAndEnableConnector.js")
const buildDSAv2 = require("../../scripts/buildDSAv2")
const encodeSpells = require("../../scripts/encodeSpells.js")
const getMasterSigner = require("../../scripts/getMasterSigner")

const addresses = require("../../scripts/constant/addresses");
const abis = require("../../scripts/constant/abis");
const constants = require("../../scripts/constant/constant");
const tokens = require("../../scripts/constant/tokens");

const connectV2CompoundArtifacts = require("../../artifacts/contracts/mainnet/connectors/compound/main.sol/ConnectV2Compound.json")
const connectV2PoolTogetherArtifacts = require("../../artifacts/contracts/mainnet/connectors/pooltogether/main.sol/ConnectV2PoolTogether.json")

const token = tokens.dai.address // DAI Token
const prizePool = "0xEBfb47A7ad0FD6e57323C8A42B2E5A6a4F68fc1a" // DAI Prize Pool
const controlledToken = "0x334cBb5858417Aee161B53Ee0D5349cCF54514CF" // PT DAI Ticket

describe("PoolTogether", function () {
    const connectorName = "COMPOUND-TEST-A"
    const ptConnectorName = "POOLTOGETHER-TEST-A"
    
    let dsaWallet0
    let masterSigner;
    let instaConnectorsV2;
    let connector;
    let ptConnector;
    
    const wallets = provider.getWallets()
    const [wallet0, wallet1, wallet2, wallet3] = wallets
    before(async () => {
        masterSigner = await getMasterSigner(wallet3)
        instaConnectorsV2 = await ethers.getContractAt(abis.core.connectorsV2, addresses.core.connectorsV2);

        // Deploy and enable Compound Connector
        connector = await deployAndEnableConnector({
            connectorName,
            contractArtifact: connectV2CompoundArtifacts,
            signer: masterSigner,
            connectors: instaConnectorsV2
        })

        // Deploy and enable Pool Together Connector
        ptConnector = await deployAndEnableConnector({
            connectorName: ptConnectorName,
            contractArtifact: connectV2PoolTogetherArtifacts,
            signer: masterSigner,
            connectors: instaConnectorsV2
        })
  })

  it("Should have contracts deployed.", async function () {
    expect(!!instaConnectorsV2.address).to.be.true;
    expect(!!connector.address).to.be.true;
    expect(!!ptConnector.address).to.be.true;
    expect(!!masterSigner.address).to.be.true;
  });

  describe("DSA wallet setup", function () {
    it("Should build DSA v2", async function () {
        dsaWallet0 = await buildDSAv2(wallet0.address)
        expect(!!dsaWallet0.address).to.be.true;
    });

    it("Deposit ETH into DSA wallet", async function () {
        await wallet0.sendTransaction({
            to: dsaWallet0.address,
            value: ethers.utils.parseEther("10")
        });
        expect(await ethers.provider.getBalance(dsaWallet0.address)).to.be.gte(ethers.utils.parseEther("10"));
    });
  });

  describe("Main", function () {

    it("Should deposit ETH in Compound", async function () {
        const amount = ethers.utils.parseEther("1") // 1 ETH
        const spells = [
            {
                connector: connectorName,
                method: "deposit",
                args: ["ETH-A", amount, 0, 0]
            }
        ]

        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()
        expect(await ethers.provider.getBalance(dsaWallet0.address)).to.be.lte(ethers.utils.parseEther("9"));
    });

    it("Should borrow DAI from Compound and deposit DAI into DAI Prize Pool", async function () {
        const amount = ethers.utils.parseEther("100") // 100 DAI
        const setId = "83478237"
        const spells = [
            {
                connector: connectorName,
                method: "borrow",
                args: ["DAI-A", amount, 0, setId]
            },
            {
                connector: ptConnectorName,
                method: "depositTo",
                args: [prizePool, dsaWallet0.address, amount, controlledToken, constants.address_zero, setId, 0]
            }
        ]
        // Before Spell
        // DAI balance 0
        let daiToken = await ethers.getContractAt(abis.basic.erc20, token)
        let daiBalance = await daiToken.balanceOf(dsaWallet0.address);
        console.log("Before spell:");
        console.log("\tDAI balance before: ", daiBalance.toString());

        // PT DAI Ticket balance is 0
        let cToken = await ethers.getContractAt(abis.basic.erc20, controlledToken)
        const balance = await cToken.balanceOf(dsaWallet0.address)
        const tokenName = await cToken.name()
        console.log("\tPTDAI balance before: ", balance.toString(), tokenName)

        // Run spell transaction
        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()

        // After spell
        // Expect DAI balance to equal 0
        daiBalance = await daiToken.balanceOf(dsaWallet0.address);
        console.log("After spell:");
        console.log("\tDAI balance after: ", daiBalance.toString());
        expect(daiBalance).to.be.eq(ethers.utils.parseEther("0"));

        // Expect PT DAI Ticket to equal 100
        const balanceAfter = await cToken.balanceOf(dsaWallet0.address)
        console.log("\tPTDAI balance after: ", balanceAfter.toString(), tokenName)
        expect(balanceAfter.toString()).to.be.eq(ethers.utils.parseEther("100"));

        expect(await ethers.provider.getBalance(dsaWallet0.address)).to.be.lte(ethers.utils.parseEther("9"));
    });

    it("Should withdraw all PrizePool", async function () {
        const amount = ethers.utils.parseEther("100") // 100 DAI
        const spells = [
            {
                connector: ptConnectorName,
                method: "withdrawInstantlyFrom",
                args: [prizePool, dsaWallet0.address, amount, controlledToken, amount, 0, 0]
            }
        ]
        
        // Before spell
        // DAI balance is 0
        let daiToken = await ethers.getContractAt(abis.basic.erc20, token)
        let daiBalance = await daiToken.balanceOf(dsaWallet0.address);
        console.log("Before Spell:")
        console.log("\tDAI balance before: ", daiBalance.toString());

        // PT Dai Ticket is 100
        let cToken = await ethers.getContractAt(abis.basic.erc20, controlledToken)
        const balance = await cToken.balanceOf(dsaWallet0.address)
        const tokenName = await cToken.name()
        console.log("\tPTDAI balance before: ", balance.toString(), tokenName)

        // Run spell transaction
        const tx = await dsaWallet0.connect(wallet0).cast(...encodeSpells(spells), wallet1.address)
        const receipt = await tx.wait()

        // After spell
        // Expect DAI balance to be greater than 90, because of early withdrawal fee
        daiBalance = await daiToken.balanceOf(dsaWallet0.address);
        console.log("After spell: ");
        console.log("\tDAI balance after: ", daiBalance.toString());
        expect(daiBalance).to.be.gt(ethers.utils.parseEther("90"));

        // Expect PT Dai Ticket to equal 0
        const balanceAfter = await cToken.balanceOf(dsaWallet0.address)
        console.log("\tPTDAI balance after: ", balanceAfter.toString(), tokenName)
        expect(balanceAfter.toNumber()).to.be.eq(0);
    });
  })
})
