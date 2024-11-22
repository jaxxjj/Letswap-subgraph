# LetSwap Subgraph

## Overview

LetSwap Subgraph indexes and tracks data from the LetSwap decentralized exchange protocol. It processes on-chain events to maintain a real-time view of the protocol's trading pairs, tokens, prices, and historical data.

## Key Data Entities

### Factory

The main protocol entity tracking:

- Total number of trading pairs
- Protocol-wide volume in ETH and USD
- Total liquidity metrics
- Transaction counts

### Pairs

Individual trading pairs containing:

- Token reserves and prices
- Trading volumes and liquidity
- Historical price data
- Transaction history

### Tokens

Detailed token information including:

- Basic metadata (symbol, name, decimals)
- Price in ETH and USD
- Trading volume metrics
- Total liquidity
- Whitelisted tokens for price tracking (see lines 35-44 in pricing.ts)

### Historical Data

Time-based aggregated data:

- Daily protocol metrics
- Hourly and daily pair data
- Token daily data
- Price and volume history

## Example Queries

### Query Protocol Stats

```graphql
{
  letswapFactory(id: "0x7acB3A63088ce38ea202203C44611cB7141461d6") {
    pairCount
    totalVolumeUSD
    totalLiquidityUSD
    txCount
  }
}
```

### Get Top Trading Pairs

```graphql
{
  pairs(first: 5, orderBy: volumeUSD, orderDirection: desc) {
    id
    token0 {
      symbol
      derivedETH
    }
    token1 {
      symbol
      derivedETH
    }
    volumeUSD
    reserveUSD
    token0Price
    token1Price
  }
}
```

### Token Historical Data

```graphql
{
  tokenDayDatas(
    first: 7
    orderBy: date
    orderDirection: desc
    where: { token: "0x..." }
  ) {
    date
    priceUSD
    dailyVolumeUSD
    totalLiquidityUSD
  }
}
```

### Protocol Daily Stats

```graphql
{
  letswapDayDatas(first: 30, orderBy: date, orderDirection: desc) {
    date
    dailyVolumeUSD
    totalLiquidityUSD
    txCount
  }
}
```

## Data Updates

The subgraph processes the following key events:

- PairCreated: Creates new trading pair entities
- Swap: Updates volumes, prices and reserves
- Sync: Updates pair reserves and prices
- Mint/Burn: Tracks liquidity changes

Data is updated in real-time as events are emitted from the LetSwap contracts.

## Price Tracking

Token prices are derived from:

- Direct ETH pairs for whitelisted tokens
- Routes through whitelisted tokens
- Minimum liquidity thresholds for price reliability
- USD prices calculated using ETH/USD price feed

For more details on price calculation logic, see:

```typescript:src/mappings/pricing.ts
startLine: 52
endLine: 87
```

## Historical Aggregation

Time-based metrics are aggregated at multiple levels:

```typescript:src/mappings/dayUpdates.ts
startLine: 16
endLine: 40
```

The subgraph maintains hourly and daily entities to enable historical analysis and charting.
