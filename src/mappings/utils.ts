/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'

import { ERC20 } from '../types/Factory/ERC20'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { User } from '../types/schema'
import { Factory as FactoryContract } from '../types/templates/Pair/Factory'
import { TokenDefinition } from './tokenDefinition'

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const FACTORY_ADDRESS = '0x7acB3A63088ce38ea202203C44611cB7141461d6'

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)

export let factoryContract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS))

export let UNTRACKED_PAIRS: string[] = ['0x9ea3b5b4ec044b70375236a281986106457b20ef']

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }

  return bd
}

export function bigDecimalExp18(): BigDecimal {
  return BigDecimal.fromString('1000000000000000000')
}

//format eth to decimal
export function convertEthToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(BI_18))
}

// format token to decimal
export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

// check if value is zero
export function equalToZero(value: BigDecimal): boolean {
  const formattedVal = parseFloat(value.toString())
  const zero = parseFloat(ZERO_BD.toString())
  if (zero == formattedVal) {
    return true
  }
  return false
}

// check if value is null
export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

// fetch token symbol
export function fetchTokenSymbol(tokenAddress: Address): string {
  // first check if there is a static definition in tokenDefinition.ts
  let staticDefinition = TokenDefinition.fromAddress(tokenAddress)
  if (staticDefinition != null) {
    return (staticDefinition as TokenDefinition).symbol
  }

  // new instance of ERC20 contract
  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol() //return call from normal symbol function
  if (symbolResult.reverted) {
    let symbolResultBytes = contractSymbolBytes.try_symbol() //return call from bytes32 symbol function
    if (!symbolResultBytes.reverted) {
      // check if bytes32 symbol is not null
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        symbolValue = symbolResultBytes.value.toString()
      }
    }
  } else {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  // first check if there is a static definition in tokenDefinition.ts
  let staticDefinition = TokenDefinition.fromAddress(tokenAddress)
  if (staticDefinition != null) {
    return (staticDefinition as TokenDefinition).name
  }

  // new instance of ERC20 contract
  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'
  let nameResult = contract.try_name() //return call result from normal name function
  if (nameResult.reverted) {
    let nameResultBytes = contractNameBytes.try_name() //return call result from bytes32 name function
    if (!nameResultBytes.reverted) {
      // check if bytes32 name is not null
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        nameValue = nameResultBytes.value.toString()
      }
    }
  } else {
    nameValue = nameResult.value
  }

  return nameValue
}

// extremely large total supply malicous token
let SKIP_TOTAL_SUPPLY: string[] = ['0x0000000000bf2686748e1c0255036e7617e7e8a5']

// fetch token total supply if revert use 0
export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  if (SKIP_TOTAL_SUPPLY.includes(tokenAddress.toHexString())) {
    return ZERO_BI
  }
  const contract = ERC20.bind(tokenAddress)
  let totalSupplyValue = ZERO_BI
  const totalSupplyResult = contract.try_totalSupply()
  if (!totalSupplyResult.reverted) {
    totalSupplyValue = totalSupplyResult.value
  }
  return totalSupplyValue
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt | null {
  // check if there is already a static definition in tokenDefinition.ts
  let staticDefinition = TokenDefinition.fromAddress(tokenAddress)
  if (staticDefinition != null) {
    return (staticDefinition as TokenDefinition).decimals
  }

  let contract = ERC20.bind(tokenAddress)
  let decimalResult = contract.try_decimals() //return call result from normal decimals function
  if (!decimalResult.reverted) {
    if (decimalResult.value.lt(BigInt.fromI32(255))) {
      return decimalResult.value
    }
  }
  return null
}

// create user if not exists
export function createUser(address: Address): void {
  let user = User.load(address.toHexString()) //return user by id if exists
  if (user === null) {
    user = new User(address.toHexString()) //create new user if not exists
    user.usdSwapped = ZERO_BD
    user.save()
  }
}
