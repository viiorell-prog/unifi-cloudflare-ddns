import { Cloudflare } from 'cloudflare';

async function updateDNS(env: any): Promise<void> {
	const apiToken = env?.CLOUDFLARE_API_TOKEN;
	if (!apiToken) throw new Error('No API token');

	const ipRes = await fetch('https://api.ipify.org?format=text', { cf: { resolveOverride: 'api.ipify.org' } } as any);
	const ip = (await ipRes.text()).trim();
	if (!ip || ip.includes(':')) throw new Error('Could not get IPv4: ' + ip);
	console.log('Current IP: ' + ip);

	const cloudflare = new Cloudflare({ apiToken });
	const zones = (await cloudflare.zones.list()).result;
	if (zones.length === 0) throw new Error('No zones found');
	const zone = zones[0];

	const allRecords = (await cloudflare.dns.records.list({ zone_id: zone.id })).result;
	const record = allRecords.find((r: any) => r.name === 'home.' + zone.name && r.type === 'A') as any;
	if (!record) throw new Error('Record not found');

	if (record.content === ip) {
		console.log('IP unchanged: ' + ip);
		return;
	}

	await cloudflare.dns.records.update(record.id, {
		content: ip,
		zone_id: zone.id,
		name: record.name,
		type: 'A',
		ttl: 1,
		proxied: record.proxied ?? false,
	});
	console.log('Updated home.' + zone.name + ' to ' + ip);
}

export default {
	async fetch(request: Request, env: any): Promise<Response> {
		try {
			await updateDNS(env);
			return new Response('OK', { status: 200 });
		} catch (error) {
			console.log('Error: ' + error);
			return new Response('Error: ' + error, { status: 500 });
		}
	},
	async scheduled(event: any, env: any): Promise<void> {
		try {
			await updateDNS(env);
		} catch (error) {
			console.log('Scheduled error: ' + error);
		}
	},
} satisfies ExportedHandler<Env>;
