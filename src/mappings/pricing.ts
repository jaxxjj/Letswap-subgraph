/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts/index'
import { Bundle, Pair, Token } from '../types/schema'
import { ADDRESS_ZERO, factoryContract, ONE_BD, UNTRACKED_PAIRS, ZERO_BD } from './utils'

// use stablecoin to price other tokens in USD

const WETH_ADDRESS = '0x5dAD5eB7a3e557642625399D51577838d26dEae0'
const DAI_WETH_PAIR = '0x786F84c5D345cC9a9af2EE5D8C53Fb3C28cd77e7' // created block 6891762
const USDT_WETH_PAIR = '0xFC76f3BAF2086C5b59ADbfe71c586e27e79Aa129' // created block 6891763

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let daiPair = Pair.load(DAI_WETH_PAIR) // dai is token1
  let usdtPair = Pair.load(USDT_WETH_PAIR) // usdt is token1

  // both pairs have been created
  if (daiPair !== null && usdtPair !== null) {
    let totalLiquidityETH = daiPair.reserve0.plus(usdtPair.reserve0) // add reserves of ETH
    let daiWeight = daiPair.reserve0.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityETH)
    return daiPair.token0Price.times(daiWeight).plus(usdtPair.token1Price.times(usdtWeight))
    // If DAI pair is the only one created
  } else if (daiPair !== null) {
    return daiPair.token0Price
    // If USDT pair is the only one created
  } else if (usdtPair !== null) {
    return usdtPair.token1Price
  } else {
    return ZERO_BD
  }
}

// tokens able to contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0x5dAD5eB7a3e557642625399D51577838d26dEae0', // WETH
  '0x69D5026d0B0642B144DA006592fEB31732C28472', // DAI
  '0xd026e6D09123909585958e50A43EEe4CE5AbCc1B', // USDT
  '0x4364d28e9AD1086473462b0782324548280b758F', // MKR
  '0xe444db678515096d273CC84c6dDfDF2D39cC6D62', // COMP
  '0xB2dfC378Fa04dB5893154c2f5a6513658648301c', // LINK
  '0x3B80270514d4354Decd5c56E6d1d93612c28643e', // UNI
  '0x200e17A99eB5D5aFDD75C1743C1a034CE75D73A2', // WBTC
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('400000')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('1')

// calculate the price of a given token in terms of ETH.
export function findEthPerToken(token: Token): BigDecimal {
  // if token is WETH, return 1
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(
      Address.fromString(token.id),
      Address.fromString(WHITELIST[i])
    )
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())

      if (pair === null) {
        continue
      }
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        if (token1 === null) {
          continue
        }
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        if (token0 === null) {
          continue
        }
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

// calculate the tracked volume of a given token pair, at least one token must be whitelisted
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice) // token0 price in USD
  let price1 = token1.derivedETH.times(bundle.ethPrice) // token1 price in USD

  // if pair is untracked, return 0
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 liquidity providers, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    // if both tokens are whitelisted, require high minimum reserve amount amount or return 0
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    // only token0 is whitelisted
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    // only token1 is whitelisted
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // only count value of the whitelisted token
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // only count value of the whitelisted token
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

// calculate the tracked liquidity of a given token pair, at least one token must be whitelisted
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
