import { int32 } from '@cat-protocol/cat-sdk'
import { ByteString, SmartContractLib, int2ByteString, method } from 'scrypt-ts'

export type OracleTimestampState = {
    //
    marker: int32
    //
    timestamp: int32
}

export class OracleTimestampStateProto extends SmartContractLib {
    static create(marker: int32, timestamp: int32): OracleTimestampState {
        return {
            marker,
            timestamp,
        }
    }

    @method()
    static toByteString(_oracleState: OracleTimestampState): ByteString {
        return (
            int2ByteString(_oracleState.marker) +
            int2ByteString(_oracleState.timestamp)
        )
    }
}
