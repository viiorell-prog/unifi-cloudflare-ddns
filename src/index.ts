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
	const url = new URL(request.url);
	const params = url.searchParams;
	let ip = (params.get('ip') || params.get('myip'))?.trim() || null;
	if (!ip || ip === 'auto' || ip.includes(':')) {
		const ipv4Res = await fetch('https://api4.ipify.org');
		ip = await ipv4Res.text();
	}
	const hostname = params.get('hostname')?.trim() || params.get('host')?.trim() || 'home.shadowbeast.uk';
	if (!hostname) {
		throw new HttpError(422, 'The "hostname" parameter is required and cannot be empty.');
	}
	const hostnames = hostname.split(',').map((h) => h.trim()).filter(Boolean);
	if (hostnames.length === 0) {
		throw new HttpError(422, 'The "hostname" parameter is required and cannot be empty.');
	}
	const records: AddressableRecord[] = [];
	for (const name of hostnames) {
		records.push({
			content: ip,
			name,
			type: 'A',
			ttl: 1,
		});
	}
	return records;
}

async function update(clientOptions: ClientOptions, newRecords: AddressableRecord[]): Promise<Response> {
	const cloudflare = new Cloudflare(clientOptions);
	const tokenStatus = (await cloudflare.user.tokens.verify()).status;
	if (tokenStatus !== 'active') {
		throw new HttpError(401, 'This API Token is ' + tokenStatus);
	}
	const zones = (await cloudflare.zones.list()).result;
	if (zones.length > 1) {
		throw new HttpError(400, 'More than one zone was found! You must supply an API Token scoped to a single zone.');
	} else if (zones.length === 0) {
		throw new HttpError(400, 'No zones found! You must supply an API Token scoped to a single zone.');
	}
	const zone = zones[0];
	for (const newRecord of newRecords) {
		console.log('Searching for record: ' + newRecord.name + ' in zone: ' + zone.name);
		const allRecords = (await cloudflare.dns.records.list({ zone_id: zone.id })).result;
		const recordName = newRecord.name.replace('.' + zone.name, '');
		console.log('Looking for: ' + recordName + ', IP: ' + newRecord.content);
		const records = allRecords.filter((r: any) => (r.name === newRecord.name || r.name === recordName) && r.type === 'A');
		if (records.length > 1) {
			throw new HttpError(400, 'More than one matching record found!');
		} else if (records.length === 0 || records[0].id === undefined) {
			throw new HttpError(400, 'No record found! You must first manually create the record.');
		}
		const currentRecord = records[0] as AddressableRecord;
		const proxied = currentRecord.proxied ?? false;
		const comment = currentRecord.comment;
		await cloudflare.dns.records.update(records[0].id, {
			content: newRecord.content,
			zone_id: zone.id,
			name: recordName as any,
			type: 'A',
			ttl: newRecord.ttl,
			proxied,
			comment,
		});
		console.log('DNS record for ' + newRecord.name + '(A) updated successfully to ' + newRecord.content);
	}
	return new Response('OK', { status: 200 });
}

export default {
	async fetch(request, env): Promise<Response> {
		console.log('Requester IP: ' + request.headers.get('CF-Connecting-IP'));
		console.log(request.method + ': ' + request.url);
		try {
			const clientOptions = cons
