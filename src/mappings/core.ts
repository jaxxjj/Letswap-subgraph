/* eslint-disable prefer-const */
import { BigDecimal, BigInt, store } from '@graphprotocol/graph-ts'

import {
  Bundle,
  Burn as BurnEvent,
  Mint as MintEvent,
  Pair,
  Swap as SwapEvent,
  Token,
  Transaction,
  LetSwapFactory,
} from '../types/schema'
import { Burn, Mint, Swap, Sync, Transfer } from '../types/templates/Pair/Pair'
import {
  updatePairDayData,
  updatePairHourData,
  updateTokenDayData,
  updateLetSwapDayData,
} from './dayUpdates'
import {
  ADDRESS_ZERO,
  BI_18,
  convertTokenToDecimal,
  createUser,
  FACTORY_ADDRESS,
  ONE_BI,
  ZERO_BD,
} from './utils'
import {
  findEthPerToken,
  getEthPriceInUSD,
  getTrackedLiquidityUSD,
  getTrackedVolumeUSD,
} from './pricing'

function isCompleteMint(mintId: string): boolean {
  return MintEvent.load(mintId)!.sender !== null
}

export function handleTransfer(event: Transfer): void {
  // ignore initial transfers for first adds
  if (
    event.params.to.toHexString() == ADDRESS_ZERO &&
    event.params.value.equals(BigInt.fromI32(1000))
  ) {
    return
  }

  let factory = LetSwapFactory.load(FACTORY_ADDRESS)!
  let transactionHash = event.transaction.hash.toHexString()

  // user stats
  let from = event.params.from
  createUser(from)
  let to = event.params.to
  createUser(to)

  // get pair and load contract
  let pair = Pair.load(event.address.toHexString())!

  // liquidity token amount being transfered
  let value = convertTokenToDecimal(event.params.value, BI_18)

  // load transaction, create if not found
  let transaction = Transaction.load(transactionHash)
  if (transaction === null) {
    transaction = new Transaction(transactionHash)
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.burns = []
    transaction.swaps = []
  }

  // mints
  let mints = transaction.mints
  // if transfer from zero address, it's a mint
  if (from.toHexString() == ADDRESS_ZERO) {
    // update total supply
    pair.totalSupply = pair.totalSupply.plus(value)
    pair.save()

    // create new mint if no mints so far or if last one is done already
    // transfers and mints come in pairs, but there could be a case where that doesn't happen and it might break
    // this is to make sure all the mints are under the same transaction
    if (mints.length === 0 || isCompleteMint(mints[mints.length - 1])) {
      let mint = new MintEvent(
        event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(mints.length).toString())
      )
      mint.transaction = transaction.id
      mint.pair = pair.id
      mint.to = to
      mint.liquidity = value
      mint.timestamp = transaction.timestamp
      mint.transaction = transaction.id
      mint.save()

      // update mints in transaction
      transaction.mints = mints.concat([mint.id])

      // save entities
      transaction.save()
      factory.save()
    }
  }

  // burns

  // Step 1: Transfer of LP tokens to the pair contract
  // When the user initiates the liquidity removal, their LP tokens are first transferred to the pair contract.
  // This is a logical burn because the tokens have not been burned yet, they are just being held in the pair contract temporarily during the removal process.
  // liquidity provider sends LP tokens to pool, gets tokens back
  // if transfer to pair, it's the first transfer of the burn process
  if (event.params.to.toHexString() == pair.id) {
    let burns = transaction.burns
    let burn = new BurnEvent(
      event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(burns.length).toString())
    )
    burn.transaction = transaction.id
    burn.pair = pair.id
    burn.liquidity = value
    burn.timestamp = transaction.timestamp
    burn.to = event.params.to
    burn.sender = event.params.from
    burn.needsComplete = true
    burn.save()

    // update burns in transaction
    transaction.burns = burns.concat([burn.id])
    transaction.save()
  }

  // Step 2: Actual burning of LP tokens
  // Shortly after, the pair contract burns the LP tokens by transferring them to the zero address.

  // it's going to be from the pair to the zero address
  // the LP token is burned and the LP position is closed
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.from.toHexString() == pair.id) {
    // update total supply
    pair.totalSupply = pair.totalSupply.minus(value)
    pair.save()

    // this is a new instance of a logical burn
    let burns = transaction.burns
    let burn: BurnEvent
    // this block creates the burn or gets the reference to it if it already exists
    if (burns.length > 0) {
      let currentBurn = BurnEvent.load(burns[burns.length - 1])!
      if (currentBurn.needsComplete) {
        burn = currentBurn as BurnEvent
      } else {
        burn = new BurnEvent(
          event.transaction.hash
            .toHexString()
            .concat('-')
            .concat(BigInt.fromI32(burns.length).toString())
        )
        burn.transaction = transaction.id
        burn.needsComplete = false
        burn.pair = pair.id
        burn.liquidity = value
        burn.timestamp = transaction.timestamp
      }
    } else {
      burn = new BurnEvent(
        event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(burns.length).toString())
      )
      burn.transaction = transaction.id
      burn.needsComplete = false
      burn.pair = pair.id
      burn.liquidity = value
      burn.timestamp = transaction.timestamp
    }

    // below is recording for sneding fees to liquidity providers
    // check if there's a mint that hasn't been completed
    if (mints.length !== 0 && !isCompleteMint(mints[mints.length - 1])) {
      let mint = MintEvent.load(mints[mints.length - 1])!
      burn.feeTo = mint.to
      burn.feeLiquidity = mint.liquidity
      // remove the logical mint
      store.remove('Mint', mints[mints.length - 1])
      // update the transaction
      mints.pop()
      transaction.mints = mints
      transaction.save()
    }

    burn.save()
    // if accessing last one, replace it
    if (burn.needsComplete) {
      burns[burns.length - 1] = burn.id
    }
    // else add new one
    else {
      burns.push(burn.id)
    }
    transaction.burns = burns
    transaction.save()
  }

  transaction.save()
}

export function handleSync(event: Sync): void {
  // sync is when the pair is updated
  let pair = Pair.load(event.address.toHex())!
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  if (token0 === null || token1 === null) {
    return
  }
  let factory = LetSwapFactory.load(FACTORY_ADDRESS)!

  // subtract tracked liquidity ETH to prepare for new value
  factory.totalLiquidityETH = factory.totalLiquidityETH.minus(pair.trackedReserveETH as BigDecimal)

  // subtract token amounts to prepare for new value
  token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1)

  pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)

  if (pair.reserve1.notEqual(ZERO_BD)) pair.token0Price = pair.reserve0.div(pair.reserve1)
  else pair.token0Price = ZERO_BD
  if (pair.reserve0.notEqual(ZERO_BD)) pair.token1Price = pair.reserve1.div(pair.reserve0)
  else pair.token1Price = ZERO_BD

  pair.save()

  // update ETH price in USD
  let bundle = Bundle.load('1')!
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  // get ETH per token
  token0.derivedETH = findEthPerToken(token0 as Token)
  token1.derivedETH = findEthPerToken(token1 as Token)
  token0.save()
  token1.save()

  // get tracked liquidity in ETH
  // will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedLiquidityUSD(
      pair.reserve0,
      token0 as Token,
      pair.reserve1,
      token1 as Token
    ).div(bundle.ethPrice)
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // use derived amounts within pair
  pair.trackedReserveETH = trackedLiquidityETH
  pair.reserveETH = pair.reserve0
    .times(token0.derivedETH as BigDecimal)
    .plus(pair.reserve1.times(token1.derivedETH as BigDecimal))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // add synced liquidity
  factory.totalLiquidityETH = factory.totalLiquidityETH.plus(trackedLiquidityETH)
  factory.totalLiquidityUSD = factory.totalLiquidityETH.times(bundle.ethPrice)

  // update token liquidity amounts
  token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1)

  // save entities
  pair.save()
  factory.save()
  token0.save()
  token1.save()
}

// handleTransfer captures the initial creation of LP tokens (ERC20 mint function).
// handleMint later adds more detailed information about the liquidity provision (record of token amounts, pair mint function).
export function handleMint(event: Mint): void {
  // load transaction and retrieve the last mint event in the transaction.mints array
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    return
  }

  let mints = transaction.mints
  let mint = MintEvent.load(mints[mints.length - 1])

  if (mint === null) {
    return
  }

  let pair = Pair.load(event.address.toHex())!
  let factory = LetSwapFactory.load(FACTORY_ADDRESS)!

  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  if (token0 === null || token1 === null) {
    return
  }

  // update exchange info
  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // calculate USD amount for the mint
  let bundle = Bundle.load('1')!
  let amountTotalUSD = token1.derivedETH
    .times(token1Amount)
    .plus(token0.derivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  pair.txCount = pair.txCount.plus(ONE_BI)
  factory.txCount = factory.txCount.plus(ONE_BI)

  // save entities
  token0.save()
  token1.save()
  pair.save()
  factory.save()

  mint.sender = event.params.sender
  mint.amount0 = token0Amount as BigDecimal
  mint.amount1 = token1Amount as BigDecimal
  mint.logIndex = event.logIndex
  mint.amountUSD = amountTotalUSD as BigDecimal
  mint.save()

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateLetSwapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

// handleBurn captures the second step of liquidity removal, where the LP tokens are actually burned (emitted by Pair contract burn function).
// handleTransfer captures the initial transfer of LP tokens to the pair contract (in ERC20 burn function).
export function handleBurn(event: Burn): void {
  // load transaction and retrieve the last burn event (transfer) in the transaction.burns array
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    return
  }

  let burns = transaction.burns
  let burn = BurnEvent.load(burns[burns.length - 1])

  if (burn === null) {
    return
  }

  let pair = Pair.load(event.address.toHex())!
  let factory = LetSwapFactory.load(FACTORY_ADDRESS)!

  //update token info
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  if (token0 === null || token1 === null) {
    return
  }

  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // calculate USD amount for the burn
  let bundle = Bundle.load('1')!
  let amountTotalUSD = token1.derivedETH
    .times(token1Amount)
    .plus(token0.derivedETH.times(token0Amount))
    .times(bundle.ethPrice)

  // update txn counts
  factory.txCount = factory.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // save entities
  token0.save()
  token1.save()
  pair.save()
  factory.save()

  // update burn
  burn.amount0 = token0Amount as BigDecimal
  burn.amount1 = token1Amount as BigDecimal
  burn.logIndex = event.logIndex
  burn.amountUSD = amountTotalUSD as BigDecimal
  burn.save()

  // update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateLetSwapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

// handleSwap captures the swap event, which is emitted by the swap function in the Pair contract.
export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString())!
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  if (token0 === null || token1 === null) {
    return
  }
  let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals)
  let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals)
  let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals)
  let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals)

  // totals for volume updates
  let amount0Total = amount0Out.plus(amount0In)
  let amount1Total = amount1Out.plus(amount1In)

  // ETH price in USD
  let bundle = Bundle.load('1')!

  // get total amounts of derived USD and ETH for tracking
  let derivedAmountETH = token1.derivedETH
    .times(amount1Total)
    .plus(token0.derivedETH.times(amount0Total))
    .div(BigDecimal.fromString('2'))
  let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(
    amount0Total,
    token0 as Token,
    amount1Total,
    token1 as Token,
    pair as Pair
  )

  let trackedAmountETH: BigDecimal
  if (bundle.ethPrice.equals(ZERO_BD)) {
    trackedAmountETH = ZERO_BD
  } else {
    trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
  }

  // update token0 global volume and token liquidity stats
  token0.tradeVolume = token0.tradeVolume.plus(amount0In.plus(amount0Out))
  token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(trackedAmountUSD)
  token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(derivedAmountUSD)

  // update token1 global volume and token liquidity stats
  token1.tradeVolume = token1.tradeVolume.plus(amount1In.plus(amount1Out))
  token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(trackedAmountUSD)
  token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(derivedAmountUSD)

  // update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD)
  pair.volumeToken0 = pair.volumeToken0.plus(amount0Total)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1Total)
  pair.untrackedVolumeUSD = pair.untrackedVolumeUSD.plus(derivedAmountUSD)
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.save()

  // update global values, only used tracked amounts for volume
  let factory = LetSwapFactory.load(FACTORY_ADDRESS)!
  factory.totalVolumeUSD = factory.totalVolumeUSD.plus(trackedAmountUSD)
  factory.totalVolumeETH = factory.totalVolumeETH.plus(trackedAmountETH)
  factory.untrackedVolumeUSD = factory.untrackedVolumeUSD.plus(derivedAmountUSD)
  factory.txCount = factory.txCount.plus(ONE_BI)

  // save entities
  pair.save()
  token0.save()
  token1.save()
  factory.save()

  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.swaps = []
    transaction.burns = []
  }

  let swaps = transaction.swaps
  let swap = new SwapEvent(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(swaps.length).toString())
  )

  // update swap event
  swap.transaction = transaction.id
  swap.pair = pair.id
  swap.timestamp = transaction.timestamp
  swap.sender = event.params.sender
  swap.amount0In = amount0In
  swap.amount1In = amount1In
  swap.amount0Out = amount0Out
  swap.amount1Out = amount1Out
  swap.to = event.params.to
  swap.from = event.transaction.from
  swap.logIndex = event.logIndex
  // use the tracked amount if applicable
  swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
  swap.save()

  // update the transaction

  swaps.push(swap.id)
  transaction.swaps = swaps
  transaction.save()

  // update day entities
  let pairDayData = updatePairDayData(event)
  let pairHourData = updatePairHourData(event)
  let letSwapDayData = updateLetSwapDayData(event)
  let token0DayData = updateTokenDayData(token0 as Token, event)
  let token1DayData = updateTokenDayData(token1 as Token, event)

  // swap specific updating
  letSwapDayData.dailyVolumeUSD = letSwapDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  letSwapDayData.dailyVolumeETH = letSwapDayData.dailyVolumeETH.plus(trackedAmountETH)
  letSwapDayData.dailyVolumeUntracked = letSwapDayData.dailyVolumeUntracked.plus(derivedAmountUSD)
  letSwapDayData.save()

  // swap specific updating for pair
  pairDayData.dailyVolumeToken0 = pairDayData.dailyVolumeToken0.plus(amount0Total)
  pairDayData.dailyVolumeToken1 = pairDayData.dailyVolumeToken1.plus(amount1Total)
  pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  pairDayData.save()

  // update hourly pair data
  pairHourData.hourlyVolumeToken0 = pairHourData.hourlyVolumeToken0.plus(amount0Total)
  pairHourData.hourlyVolumeToken1 = pairHourData.hourlyVolumeToken1.plus(amount1Total)
  pairHourData.hourlyVolumeUSD = pairHourData.hourlyVolumeUSD.plus(trackedAmountUSD)
  pairHourData.save()

  // swap specific updating for token0
  token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Total)
  token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH.plus(
    amount0Total.times(token0.derivedETH as BigDecimal)
  )
  token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD.plus(
    amount0Total.times(token0.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token0DayData.save()

  // swap specific updating
  token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Total)
  token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH.plus(
    amount1Total.times(token1.derivedETH as BigDecimal)
  )
  token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD.plus(
    amount1Total.times(token1.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  token1DayData.save()
}
