import {
    ByteString,
    Int32,
    StatefulCovenant,
    SupportedNetwork,
    toByteString,
} from '@scrypt-inc/scrypt-ts-btc'
import { CAT20Buy } from '../../contracts/cat20/cat20Buy'
import { DexState } from '../../contracts/cat20/types'
export class CAT20BuyCovenant extends StatefulCovenant<DexState> {
    constructor(
        cat20Script: ByteString,
        buyerAddress: ByteString,
        price: Int32,
        scalePrice: boolean,
        network?: SupportedNetwork
    ) {
        super(
            { ownerAddr: toByteString('') },
            [
                {
                    contract: new CAT20Buy(
                        cat20Script,
                        buyerAddress,
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
