import { isHexString } from '@ethersproject/bytes';
import { OPENSEA_API_KEY } from 'react-native-dotenv';
import { rainbowFetch } from '../rainbow-fetch';
import { ENS_NFT_CONTRACT_ADDRESS } from '../references';
import { abbreviations } from '../utils';
import {
  convertAddressToENSOrAddressDisplay,
  FormatAssetForDisplay,
} from '@rainbow-me/helpers';
import NetworkTypes from '@rainbow-me/networkTypes';
import { parseAccountUniqueTokens } from '@rainbow-me/parsers';
import { handleSignificantDecimals } from '@rainbow-me/utilities';
import logger from 'logger';

export const UNIQUE_TOKENS_LIMIT_PER_PAGE = 50;
export const UNIQUE_TOKENS_LIMIT_TOTAL = 2000;

export const apiGetAccountUniqueTokens = async (network, address, page) => {
  try {
    const networkPrefix = network === NetworkTypes.mainnet ? '' : `${network}-`;
    const offset = page * UNIQUE_TOKENS_LIMIT_PER_PAGE;
    const url = `https://${networkPrefix}api.opensea.io/api/v1/assets`;
    const data = await rainbowFetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': OPENSEA_API_KEY,
      },
      method: 'get',
      params: {
        limit: UNIQUE_TOKENS_LIMIT_PER_PAGE,
        offset: offset,
        owner: address,
      },
      timeout: 20000, // 20 secs
    });
    return parseAccountUniqueTokens(data);
  } catch (error) {
    logger.log('Error getting unique tokens', error);
    throw error;
  }
};

export const apiGetUniqueTokenFloorPrice = async (
  network,
  urlSuffixForAsset
) => {
  try {
    const networkPrefix = network === NetworkTypes.mainnet ? '' : `${network}-`;
    const url = `https://${networkPrefix}api.opensea.io/api/v1/asset/${urlSuffixForAsset}`;
    const EthSuffix = ' ETH';
    const data = await rainbowFetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': OPENSEA_API_KEY,
      },
      method: 'get',
      timeout: 5000, // 5 secs
    });
    if (JSON.stringify(data.data.collection.stats.floor_price) === '0') {
      return 'None';
    }
    const formattedFloorPrice =
      JSON.stringify(data.data.collection.stats.floor_price) + EthSuffix;
    return formattedFloorPrice;
  } catch (error) {
    throw error;
  }
};

const fetchAllTokenHistoryEvents = async ({
  semiFungible,
  accountAddress,
  contractAddress,
  tokenID,
}) => {
  let offset = 0;
  let array = [];
  let nextPage = true;
  while (nextPage) {
    const urlPage = semiFungible
      ? `https://api.opensea.io/api/v1/events?account_address=${accountAddress}&asset_contract_address=${contractAddress}&token_id=${tokenID}&only_opensea=false&offset=${offset}&limit=299`
      : `https://api.opensea.io/api/v1/events?asset_contract_address=${contractAddress}&token_id=${tokenID}&only_opensea=false&offset=${offset}&limit=299`;

    let currentPage = await rainbowFetch(urlPage, {
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': OPENSEA_API_KEY,
      },
      method: 'get',
      timeout: 10000, // 10 secs
    });

    array = array.concat(currentPage?.data?.asset_events || []);
    offset = array.length + 1;
    nextPage = currentPage?.data?.asset_events?.length === 299;
  }
  return array;
};

export const apiGetTokenHistory = async (
  contractAddress,
  tokenID,
  accountAddress
) => {
  try {
    const checkFungibility = `https://api.opensea.io/api/v1/events?asset_contract_address=${contractAddress}&token_id=${tokenID}&only_opensea=false&offset=0&limit=1`;
    logger.log(checkFungibility);

    const fungData = await rainbowFetch(checkFungibility, {
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': OPENSEA_API_KEY,
      },
      method: 'get',
      timeout: 10000, // 10 secs
    });

    const semiFungible =
      fungData?.data?.asset_events[0]?.asset?.asset_contract
        ?.asset_contract_type === 'semi-fungible';

    const allEvents = await fetchAllTokenHistoryEvents({
      accountAddress,
      contractAddress,
      semiFungible,
      tokenID,
    });
    logger.debug('ALL EVENTS', allEvents.length);

    const result = await filterAndMapData(contractAddress, allEvents);
    logger.debug('results length', result.length);

    return result;
  } catch (error) {
    logger.debug('FETCH ERROR:', error);
    throw error;
  }
};

//Need to figure out how to do this without querying ethers 1000 times
// Follow up with Bruno
// const address =
//   (uniqueEvent.to_account?.address &&
//     (await GetAddress(uniqueEvent.to_account.address))) ||
//   '????';
// async function GetAddress(address) {
// const addy = await convertAddressToENSOrAddressDisplay(address);
// if (isHexString(address)) {
//   const abbrevAddy = abbreviations.address(address, 2);
//   return abbrevAddy;
// }
// const abbrevENS = abbreviations.formatAddressForDisplay(addy);

// return abbrevENS;
// }

const filterAndMapData = async (contractAddress, array) => {
  return Promise.all(
    array
      .filter(
        ({ event_type }) =>
          event_type === 'created' ||
          event_type === 'transfer' ||
          event_type === 'successful' ||
          event_type === 'cancelled'
      )
      .map(async function (uniqueEvent) {
        let event_type = uniqueEvent.event_type;
        let eventObject;
        let created_date = uniqueEvent.created_date;
        let from_account = '0x123';
        let to_account = '0x123';
        let sale_amount = '0';
        let list_amount = '0';
        let payment_token = 'x';
        let to_account_eth_address = 'x';

        switch (event_type) {
          case 'transfer': {
            const address = uniqueEvent.to_account?.address || '????';
            let from_acc = uniqueEvent.from_account?.address;
            if (
              contractAddress === ENS_NFT_CONTRACT_ADDRESS &&
              from_acc === '0x0000000000000000000000000000000000000000'
            ) {
              event_type = 'ens-registration';
              to_account_eth_address = uniqueEvent.to_account.address;
              to_account = address;
            } else if (
              contractAddress !== ENS_NFT_CONTRACT_ADDRESS &&
              from_acc === '0x0000000000000000000000000000000000000000'
            ) {
              event_type = 'mint';
              to_account_eth_address = uniqueEvent.to_account.address;
              to_account = address;
            } else {
              to_account_eth_address = uniqueEvent.to_account.address;
              to_account = address;
            }
            break;
          }
          case 'successful':
            payment_token = 
              uniqueEvent.payment_token?.symbol === 'WETH'
                ? 'ETH'
                : uniqueEvent.payment_token?.symbol;
            // eslint-disable-next-line no-case-declarations
            const temp_sale_amount = FormatAssetForDisplay({
              amount: uniqueEvent.total_price,
              token: payment_token,
            });

            sale_amount = handleSignificantDecimals(temp_sale_amount, 5);
            break;

          case 'cancelled':
            break;

          default:
          case 'created':
            payment_token =
              uniqueEvent.payment_token?.symbol === 'WETH'
                ? 'ETH'
                : uniqueEvent.payment_token?.symbol;
            // eslint-disable-next-line no-case-declarations
            const temp_list_amount = FormatAssetForDisplay({
              amount: uniqueEvent.starting_price,
              token: payment_token,
            });
            list_amount = handleSignificantDecimals(temp_list_amount, 5);

            break;
        }
        eventObject = {
          created_date,
          event_type,
          from_account,
          list_amount,
          payment_token,
          sale_amount,
          to_account,
          to_account_eth_address,
        };

        return eventObject;
      })
  );
};
