import { MAX_INPUT, int32 } from '@cat-protocol/cat-smartcontracts'
import {
    method,
    toByteString,
    ByteString,
    SmartContractLib,
    len,
    int2ByteString,
    assert,
    FixedArray,
    sha256,
} from 'scrypt-ts'

export type SpentAmountsCtx = FixedArray<ByteString, typeof MAX_INPUT>

export class SellUtil extends SmartContractLib {
    @method()
    static mergeSpentAmounts(spentAmounts: SpentAmountsCtx): ByteString {
        let result = toByteString('')
        for (let index = 0; index < MAX_INPUT; index++) {
            const spentAmount = spentAmounts[index]
            assert(len(spentAmount) == 8n)
            result += spentAmount
        }
        return result
    }

    @method()
    static checkSpentAmountsCtx(
        spentAmounts: SpentAmountsCtx,
        hashSpentAmounts: ByteString
    ): boolean {
        // check spent amounts
        assert(
            sha256(SellUtil.mergeSpentAmounts(spentAmounts)) ==
                hashSpentAmounts,
            'spentAmountsCtx mismatch'
        )
        return true
    }

    @method()
    static int32ToSatoshiBytes(amount: int32): ByteString {
        assert(amount > 0n)
        let amountBytes = int2ByteString(amount)
        const amountBytesLen = len(amountBytes)
        if (amountBytesLen == 1n) {
            amountBytes += toByteString('000000')
        } else if (amountBytesLen == 2n) {
            amountBytes += toByteString('0000')
        } else if (amountBytesLen == 3n) {
            amountBytes += toByteString('00')
        }
        return amountBytes + toByteString('00000000')
    }
}
