import {
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '@cat-protocol/cat-sdk'
import { PubKey, SmartContract, assert, hash160, method, prop } from 'scrypt-ts'
import { OracleLib } from '../oracleLib'
import { OraclePriceState, OraclePriceStateProto } from './priceProto'

export class DexUsePrice extends SmartContract {
    @prop()
    oracleKey: PubKey

    constructor(oracleKey: PubKey) {
        super(...arguments)
        this.oracleKey = oracleKey
    }

    @method()
    public unlock(
        priceData: OraclePriceState,
        publickey: PubKey,
        oracleInputIndex: bigint,
        shPreimage: SHPreimage,
        spentScriptsCtx: SpentScriptsCtx
    ) {
        // Check sighash preimage.
        assert(
            this.checkSig(
                SigHashUtils.checkSHPreimage(shPreimage),
                SigHashUtils.Gx
            ),
            'preimage check error'
        )
        SigHashUtils.checkSpentScriptsCtx(
            spentScriptsCtx,
            shPreimage.hashSpentScripts
        )
        const oracleLocking = OracleLib.buildOracleP2wsh(
            hash160(OraclePriceStateProto.toByteString(priceData)),
            this.oracleKey,
            publickey
        )
        assert(
            spentScriptsCtx[Number(oracleInputIndex)] == oracleLocking,
            'oracle script mismatch'
        )
    }
}
