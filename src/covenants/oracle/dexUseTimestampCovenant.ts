import {
    Covenant,
    InputContext,
    SubContractCall,
    SupportedNetwork,
} from '@cat-protocol/cat-sdk'
import { PubKey } from 'scrypt-ts'
import { OracleTimestampState } from '../../contracts/oracle/examples/timestampProto'
import { DexUseTimestamp } from '../../contracts/oracle/examples/dexUseTimestamp'

export class DexUseTimestampCovenant extends Covenant {
    static readonly LOCKED_ASM_VERSION = '48930e9536e1fe020d544d8e4e77bc8c'

    constructor(oracleKey: PubKey, network?: SupportedNetwork) {
        super(
            [
                {
                    contract: new DexUseTimestamp(oracleKey),
                },
            ],
            {
                lockedAsmVersion: DexUseTimestampCovenant.LOCKED_ASM_VERSION,
                network,
            }
        )
    }

    serializedState() {
        return ''
    }

    unlock(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        timestampData: OracleTimestampState,
        publickey: PubKey,
        oracleInputIndex: bigint
    ): SubContractCall {
        return {
            method: 'unlock',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                timestampData,
                publickey,
                oracleInputIndex
            ),
        }
    }

    private unlockArgsBuilder(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        timestampData: OracleTimestampState,
        publickey: PubKey,
        oracleInputIndex: bigint
    ) {
        const inputCtx = inputCtxs.get(inputIndex)
        if (!inputCtx) {
            throw new Error('Input context is not available')
        }

        return () => {
            const { shPreimage, spentScriptsCtx } = inputCtx
            const args = []
            args.push(timestampData) // timestampData
            args.push(publickey) // publickey
            args.push(oracleInputIndex) // oracleInputIndex
            args.push(shPreimage) // shPreimage
            args.push(spentScriptsCtx) // spentScriptsCtx
            return args
        }
    }
}
