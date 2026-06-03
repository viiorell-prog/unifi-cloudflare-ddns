import { Cloudflare } from 'cloudflare';

async function updateDNS(env: any): Promise<void> {
	const apiToken = env?.CLOUDFLARE_API_TOKEN;
	if (!apiToken) throw new Error('No API token');

	// Citeste IP-ul de la No-IP hostname
	const noipHostname = 'predatort7.ddns.net';
	const dnsRes = await fetch('https://cloudflare-dns.com/dns-query?name=' + noipHostname + '&type=A', {
		headers: { 'Accept': 'application/dns-json' }
	});
	const dnsData: any = await dnsRes.json();
	const ip = dnsData?.Answer?.[0]?.data;
	if (!ip || ip.includes(':')) throw new Error('Could not get IP from No-IP: ' + JSON.stringify(dnsData));
	console.log('IP from No-IP: ' + ip);

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
