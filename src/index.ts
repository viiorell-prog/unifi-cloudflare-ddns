import { ClientOptions, Cloudflare } from 'cloudflare';
import { AAAARecord, ARecord } from 'cloudflare/src/resources/dns/records.js';
type AddressableRecord = AAAARecord | ARecord;

class HttpError extends Error {
	constructor(
		public statusCode: number,
		message: string,
	) {
		super(message);
		this.name = 'HttpError';
	}
}

function constructClientOptions(request: Request, env?: any): ClientOptions {
	const env_token = (env && env.CLOUDFLARE_API_TOKEN) ? env.CLOUDFLARE_API_TOKEN : null;
	if (env_token) {
		return { apiToken: env_token };
	}
	const authorization = request.headers.get('Authorization');
	if (!authorization) {
		throw new HttpError(401, 'API token missing.');
	}
	const [, data] = authorization.split(' ');
	const decoded = atob(data);
	const index = decoded.indexOf(':');
	if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) {
		throw new HttpError(401, 'Invalid API key or token.');
	}
	return {
		apiEmail: decoded.substring(0, index),
		apiToken: decoded.substring(index + 1),
	};
}

async function constructDNSRecords(request: Request): Promise<AddressableRecord[]> {
	console.log('All headers: ' + JSON.stringify(Object.fromEntries(request.headers)));
	const url = new URL(request.url);
	const params = url.searchParams;
	let ip = (params.get('ip') || params.get('myip'))?.trim() || null;
	console.log('IP from params: ' + ip);
	if (!ip || ip === 'auto' || ip.includes(':')) {
		const cfIpv4 = request.headers.get('CF-Connecting-IPv4');
		const cfIp = request.headers.get('CF-Connecting-IP') || '';
		const extractedIpv4 = cfIp.replace(/^.*:(\d+\.\d+\.\d+\.\d+)$/, '$1');
		ip = cfIpv4 || (extractedIpv4 !== cfIp ? extractedIpv4 : null);
		console.log('IP from headers: ' + ip);
	}
	if (!ip) {
		throw new HttpError(422, 'Could not determine IPv4 address.');
	}
	const hostname = params.get('hostname')?.trim() || params.get('host')?.trim() ||
