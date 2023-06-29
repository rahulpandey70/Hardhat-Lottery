const { network, getNamedAccounts, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
const { assert, expect } = require("chai")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery unit test", function () {
          let lottery,
              lotteryContract,
              vrfCoordinatorV2Mock,
              lotteryEntranceFee,
              interval,
              player,
              deployer
          const chainId = network.config.chainId

          beforeEach(async function () {
              accounts = await ethers.getSigners()
              player = accounts[1]
              await deployments.fixture(["mocks", "lottery"])
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
              lotteryContract = await ethers.getContract("Lottery")
              lottery = lotteryContract.connect(player)
              lotteryEntranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })

          describe("constructor", () => {
              it("Initializes the lottery correctly", async () => {
                  const lotteryState = (await lottery.getLotteryState()).toString()
                  assert.equal(lotteryState, "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterLottery", () => {
              it("revert when you dont pay enough", async () => {
                  await expect(lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NotEnoughETHEntered"
                  )
              })
              it("records players when they enter", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  const contractPlayer = await lottery.getPlayer(0)
                  assert.equal(player.address, contractPlayer)
              })
              it("emits event on enter", async () => {
                  await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.emit(
                      lottery,
                      "LotteryEnter"
                  )
              })
              it("doesn't allow entrance when lottery is calculating", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })

                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  // We pretend to be a chainlink keeper
                  await lottery.performUpkeep([])
                  await expect(
                      lottery.enterLottery({ value: lotteryEntranceFee })
                  ).to.be.revertedWith("Lottery__NotOpen")
              })
          })

          describe("checkupkeep", () => {
              it("return false if people haven't sent any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })

                  const { upKeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(!upKeepNeeded)
              })
              it("returns false if lottery isn't open", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await lottery.performUpkeep([])
                  const lotteryState = await lottery.getLotteryState()
                  const { upKeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert.equal(lotteryState.toString() == "1", upKeepNeeded == false)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upKeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(!upKeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upKeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(upKeepNeeded)
              })
          })

          describe("performUpkeep", () => {
              it("can only run if checkupkeep is true", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const tx = await lottery.performUpkeep([])
                  assert(tx)
              })
              it("reverts when checkup is false", async () => {
                  await expect(lottery.performUpkeep([])).to.be.revertedWith(
                      "Lottery__UpKeepNotNeeded"
                  )
              })
              it("updates the lottery state, emits a requestId", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const txResponse = await lottery.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const lotteryState = await lottery.getLotteryState()
                  const requestId = txReceipt.events[1].args.requestId
                  assert(requestId.toNumber() > 0)
                  assert(lotteryState == 1)
              })
          })

          describe("fulfillRandomWords", () => {
              beforeEach(async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
              })
              it("can only be called after performUpkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              it("picks a winner , resets the lottery , and sends money", async () => {
                  const additonalEnternace = 3
                  const startingIndex = 2 // deployer = 0
                  const accounts = await ethers.getSigners()

                  // connecting 3 extra people to the rafffle , not including the deployer which makes it 4
                  for (let i = startingIndex; i < startingIndex + additonalEnternace; i++) {
                      lottery = lotteryContract.connect(accounts[i])
                      await lottery.enterLottery({ value: lotteryEntranceFee })
                  }
                  const startingTimeStamp = await lottery.getLatestTimeStamp()

                  // performUpKeep {mock being chainLink keepers}
                  // fullfillRandomWords {mock being the chainLink VRF}
                  // IF WE ON TESTNET : we have to wait for the fullfillRandomWords
                  await new Promise(async (resolve, reject) => {
                      // Listening for the winnerPicked Event
                      lottery.once("WinnerPicked", async () => {
                          console.log("Found the event")
                          try {
                              const recentWinner = await lottery.getRecentWinner()
                              console.log(`the Last winner was : ${recentWinner}`)

                              console.log(
                                  "------------------------All Accounts------------------------"
                              )
                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[2].address)
                              console.log(accounts[3].address)

                              const lotteryState = await lottery.getLotteryState()
                              const winnerBalance = await accounts[2].getBalance()
                              const endingTimeStamp = await lottery.getLatestTimeStamp()
                              const numPlayers = await lottery.getNumberOfPlayers()

                              // asserts
                              assert.equal(recentWinner.toString(), accounts[2].address)
                              assert.equal(lotteryState, 0)
                              assert.equal(
                                  winnerBalance.toString(),
                                  startingBalance
                                      .add(
                                          lotteryEntranceFee
                                              .mul(additonalEnternace)
                                              .add(lotteryEntranceFee)
                                      )
                                      .toString()
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve()
                          } catch (error) {
                              reject(error)
                          }
                      })
                      // setting up a listener

                      // below , we will fire the event , and the listner will pick it up , and resolve
                      const tx = await lottery.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const startingBalance = await accounts[2].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      )
                  })
              })
          })
      })
