import { join } from 'path'
import { CAT20Sell } from './contracts/cat20Sell'
;(() => {
    CAT20Sell.loadArtifact(
        join(__dirname, '..', 'artifacts', 'token', 'cat20Sell.json')
    )
})()
export * from './contracts/cat20Sell'
