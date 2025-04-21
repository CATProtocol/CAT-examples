import { CAT20Buy } from '../../../src/contracts/cat20/cat20Buy'
import { CAT20Sell } from '../../../src/contracts/cat20/cat20Sell'
import { readArtifact } from '../../utils'

export const loadAllArtifacts = function () {
    CAT20Buy.loadArtifact(readArtifact('artifacts/cat20/cat20Buy.json'))
    CAT20Sell.loadArtifact(readArtifact('artifacts/cat20/cat20Sell.json'))
}
