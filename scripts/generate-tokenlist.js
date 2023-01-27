require('dotenv').config();

const { ethers } = require('ethers');
const fs = require('fs');
const fleek = require('@fleekhq/fleek-storage-js');

const { getTokenMetadata, getTrustWalletAssetAddresses } = require('./token-data');

const fleekApiKey = process.env.FLEEK_API_KEY;
const fleekApiSecret = process.env.FLEEK_API_SECRET;
const fleekBucket = 'lyfebloc-team-bucket';

async function run() {
	try {
		const data = await getData();

		const listedFile = await fs.readFileSync('lists/listed.json');
		const listed = JSON.parse(listedFile);
		const listedMetadata = await getMetadata(listed, data.metadataOverwrite);
		const listedTokens = getTokens(data, listedMetadata);

		const eligibleFile = await fs.readFileSync('lists/eligible.json');
		const uiFile = await fs.readFileSync('lists/ui-not-eligible.json');
		const eligible = JSON.parse(eligibleFile);
		const ui = JSON.parse(uiFile);

		const vetted = {
			goerli: [...Object.keys(eligible.goerli), ...ui.goerli],
			homestead: [...Object.keys(eligible.homestead), ...ui.homestead],
		};
		const vettedMetadata = await getMetadata(vetted, data.metadataOverwrite);
		const vettedTokens = getTokens(data, vettedMetadata);

		await generate('listed', listedTokens);
		await generate('vetted', vettedTokens);
	} catch(e) {
		console.error(e);
		process.exit(1);
	}
}

async function generate(name, tokens) {
	const nowTimestamp = Date.now();
	const dayTimestamp = nowTimestamp - (nowTimestamp % (24 * 60 * 60 * 1000));
	const date = new Date(dayTimestamp);
	const timestamp = date.toISOString();
	const list = {
		name: 'Lyfebloc',
		timestamp,
		logoURI: 'https://raw.githubusercontent.com/lyfebloc/pebbles/master/images/pebbles-pad.256w.png',
		keywords: [
			'lyfebloc',
			name,
		],
		version: {
			major: 1,
			minor: 0,
			patch: 0,
		},
		tokens,
	};
	const listFileName = `generated/${name}.tokenlist.json`;
	await fs.writeFileSync(listFileName, JSON.stringify(list, null, 4));

	if (fleekApiSecret) {
		try {
			await ipfsPin(`assets/${name}.tokenlist.json`, list);
			console.log(`Tokenlist uploaded for ${name}`);
		} catch (e) {
			throw new Error('Failed to pin list on IPFS');
		}
	} else {
		console.log('Fleek API secret is not available');
	}
}

async function getData() {
	const metadataOverwriteFile = await fs.readFileSync('data/metadataOverwrite.json');
	const metadataOverwrite = JSON.parse(metadataOverwriteFile);

	const localAssetDirFiles = await fs.readdirSync('assets');
	const localAssets = localAssetDirFiles
		.filter(assetFile => assetFile !== 'index.json')
		.map(assetFile => assetFile.split('.png')[0]);

  const trustwalletAssets = await getTrustWalletAssetAddresses()

	const assets = {
		local: localAssets,
		trustwallet: trustwalletAssets,
	}

	return {
		metadataOverwrite,
		assets,
	};
}

async function getMetadata(tokens, overwrite) {
	const goerli = await getTokenMetadata('goerli', tokens.goerli, overwrite.goerli);
	const homestead = await getTokenMetadata('homestead', tokens.homestead, overwrite.homestead);

	return {
		goerli,
		homestead,
	};
}

function getTokens(data, metadata) {
	const tokens = [];
	for (const address in metadata.homestead) {
		const chainId = 1;
		const token = metadata.homestead[address];
		const { decimals, symbol, name } = token;
		tokens.push({
			address,
			chainId,
			name,
			symbol,
			decimals,
			logoURI: getLogoURI(data.assets, address),
		});
	}
	for (const address in metadata.goerli) {
		const chainId = 42;
		const token = metadata.goerli[address];
		const { decimals, symbol, name } = token;
		tokens.push({
			address,
			chainId,
			name,
			symbol,
			decimals,
			logoURI: getLogoURI(data.assets, address),
		});
	}
	return tokens;
}

function getLogoURI(assets, address) {
	address = getMainnetAddress(address);
	if (address === 'ether') {
		return 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png'
	}
	if (assets.local.includes(address.toLowerCase())) {
		return `https://raw.githubusercontent.com/lyfebloc/assets/master/assets/${address.toLowerCase()}.png`
	}
	if (assets.trustwallet.includes(address)) {
		return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${address}/logo.png`;
	}
	return undefined;
}

function getMainnetAddress(address) {
	const map = {
		'0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		'0x41286Bb1D3E870f3F750eB7E1C25d7E48c8A1Ac7': '0x317472CCb2b741E87bc0F76B4C0c325C80E9D851',
		'0xc2569dd7d0fd715B054fBf16E75B001E5c0C1115': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
		'0xAf9ac3235be96eD496db7969f60D354fe5e426B0': '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
		'0x04DF6e4121c27713ED22341E7c7Df330F56f289B': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
		'0x8F4beBF498cc624a0797Fe64114A6Ff169EEe078': '0xbC396689893D065F41bc2C6EcbeE5e0085233447',
		'0x1C8E3Bcb3378a443CC591f154c5CE0EBb4dA9648': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
	};
	return map[address] || address;
}

async function ipfsPin(key, body) {
	let ipfsHash;
	const input = {
		apiKey: fleekApiKey,
		apiSecret: fleekApiSecret,
		bucket: fleekBucket,
		key,
		data: JSON.stringify(body)
	};
	const result = await fleek.upload(input);
	ipfsHash = result.hashV0;
	return ipfsHash;
}

run();
