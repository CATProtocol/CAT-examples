# CAT examples

## create .env

## Prerequisites

```bash
npm i
npm run compile
```

## run features

```bash
# create new order info
ts-node tests/testnet/features/cat721/sell/createSellOrder.ts
# cancel an order(order info need use createSellOrder generate)
ts-node tests/testnet/features/cat721/sell/cancelSellOrder.ts
# take an order(order info need use createSellOrder generate)
ts-node tests/testnet/features/cat721/sell/takeSellOrder.ts
# change order info, then create new order info(order info need use createSellOrder generate)
ts-node tests/testnet/features/cat721/sell/updateSellOrder.ts
```
