import {
    ByteString,
    Int32,
    StatefulCovenant,
    SupportedNetwork,
    toByteString,
} from '@scrypt-inc/scrypt-ts-btc'
import { CAT20Sell } from '../../contracts/cat20/cat20Sell'
import { DexState } from '../../contracts/cat20/types'
export class CAT20SellCovenant extends StatefulCovenant<DexState> {
    constructor(
        cat20Script: ByteString,
        recvOutput: ByteString,
        sellerAddress: ByteString,
        price: Int32,
        scalePrice: boolean,
        network?: SupportedNetwork
    ) {
        super(
            { ownerAddr: toByteString('') },
            [
                {
                    contract: new CAT20Sell(
                        cat20Script,
                        recvOutput,
                        sellerAddress,
                        BigInt(price),
                        scalePrice
                    ),
                },
            ],
            {
                network,
            }
        )
    }
}
