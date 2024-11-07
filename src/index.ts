import { CAT20Sell } from './contracts/cat20Sell'
import { BuyCAT20 } from './contracts/buyCAT20'
import { CATTimeLock } from './contracts/nft/catTimeLock'
import { LockToMint } from './contracts/nft/lockToMint'

export * from './contracts/nft/catTimeLock'
export * from './contracts/nft/lockToMint'
export * from './contracts/cat20Sell'
export * from './contracts/buyCAT20'
import catTimeLock from '../artifacts/nft/catTimeLock.json'
import lockToMint from '../artifacts/nft/lockToMint.json'
import cat20Sell from '../artifacts/cat20Sell.json'
import buyCAT20 from '../artifacts/buyCAT20.json'
;(() => {
    BuyCAT20.loadArtifact(buyCAT20)
    CAT20Sell.loadArtifact(cat20Sell)
    CATTimeLock.loadArtifact(catTimeLock)
    LockToMint.loadArtifact(lockToMint)
})()
