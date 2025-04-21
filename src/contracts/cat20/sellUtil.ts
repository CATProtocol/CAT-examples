import {
    SmartContractLib,
    method,
    ByteString,
    len,
    toByteString,
    assert,
    int32ToByteString,
    Int32,
} from '@scrypt-inc/scrypt-ts-btc'

export class SellUtil extends SmartContractLib {
    @method()
    static int32ToSatoshiBytes(amount: Int32, scale: boolean): ByteString {
        assert(amount > 0n)
        let amountBytes = scale
            ? SellUtil.scale2ByteString(amount)
            : int32ToByteString(amount)
        const amountBytesLen = len(amountBytes)
        if (amountBytesLen == 1n) {
            amountBytes += toByteString('00000000000000')
        } else if (amountBytesLen == 2n) {
            amountBytes += toByteString('000000000000')
        } else if (amountBytesLen == 3n) {
            amountBytes += toByteString('0000000000')
        } else if (amountBytesLen == 4n) {
            amountBytes += toByteString('00000000')
        } else if (amountBytesLen == 5n) {
            amountBytes += toByteString('000000')
        } else if (amountBytesLen == 6n) {
            amountBytes += toByteString('0000')
        } else if (amountBytesLen == 7n) {
            amountBytes += toByteString('00')
        }
        return amountBytes
    }

    @method()
    static scale2ByteString(amount: Int32): ByteString {
        return toByteString('00') + int32ToByteString(amount)
    }
}
