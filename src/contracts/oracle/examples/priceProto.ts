import { int32 } from '@cat-protocol/cat-sdk'
import { ByteString, SmartContractLib, int2ByteString, method } from 'scrypt-ts'

export type OraclePriceState = {
    //
    marker: int32
    //
    timestamp: int32
    //
    price: int32
    //
    decimals: int32
    //
    tradingPair: ByteString
}

export class OraclePriceStateProto extends SmartContractLib {
    static create(
        marker: int32,
        timestamp: int32,
        price: int32,
        decimals: int32,
        tradingPair: ByteString
    ): OraclePriceState {
        return {
            marker,
            timestamp,
            price,
            decimals,
            tradingPair,
        }
    }

    @method()
    static toByteString(_oracleState: OraclePriceState): ByteString {
        return (
            int2ByteString(_oracleState.marker) +
            int2ByteString(_oracleState.timestamp) +
            int2ByteString(_oracleState.price) +
            int2ByteString(_oracleState.decimals) +
            _oracleState.tradingPair
        )
    }
}
