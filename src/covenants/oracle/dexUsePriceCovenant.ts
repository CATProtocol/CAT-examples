import {
    Covenant,
    InputContext,
    SubContractCall,
    SupportedNetwork,
} from '@cat-protocol/cat-sdk'
import { PubKey } from 'scrypt-ts'
import { OraclePriceState } from '../../contracts/oracle/examples/priceProto'
import { DexUsePrice } from '../../contracts/oracle/examples/dexUsePrice'

export class DexUsePriceCovenant extends Covenant {
    static readonly LOCKED_ASM_VERSION = '98b93427827feee296d7ced39b37a65b'

    constructor(oracleKey: PubKey, network?: SupportedNetwork) {
        super(
            [
                {
                    contract: new DexUsePrice(oracleKey),
                },
            ],
            {
                lockedAsmVersion: DexUsePriceCovenant.LOCKED_ASM_VERSION,
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
        priceData: OraclePriceState,
        publickey: PubKey,
        oracleInputIndex: bigint
    ): SubContractCall {
        return {
            method: 'unlock',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                priceData,
                publickey,
                oracleInputIndex
            ),
        }
    }

    private unlockArgsBuilder(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        priceData: OraclePriceState,
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
            args.push(priceData) // priceData
            args.push(publickey) // publickey
            args.push(oracleInputIndex) // oracleInputIndex
            args.push(shPreimage) // shPreimage
            args.push(spentScriptsCtx) // spentScriptsCtx
            return args
        }
    }
}
