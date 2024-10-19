import { Address, BigInt } from '@graphprotocol/graph-ts'

export class TokenDefinition {
  address: Address
  symbol: string
  name: string
  decimals: BigInt

  // Get all tokens with a static defintion
  static getStaticDefinitions(): Array<TokenDefinition> {
    const staticDefinitions: Array<TokenDefinition> = [
      {
        address: Address.fromString('0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'),
        symbol: 'AAVE',
        name: 'Aave Token',
        decimals: BigInt.fromI32(18),
      },
    ]
    return staticDefinitions
  }

  // get static definition from address
  static fromAddress(tokenAddress: Address): TokenDefinition | null {
    const staticDefinitions = this.getStaticDefinitions()
    const tokenAddressHex = tokenAddress.toHexString()

    // Search the definition using the address
    for (let i = 0; i < staticDefinitions.length; i++) {
      const staticDefinition = staticDefinitions[i]
      if (staticDefinition.address.toHexString() == tokenAddressHex) {
        return staticDefinition
      }
    }

    return null
  }
}
