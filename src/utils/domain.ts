// Function to get protocol and domain from request context
export function getDomainAndProtocolFromRequest(c: {
	req: { header: (name: string) => string | undefined };
}): { protocol: string; domain: string } {
	const host = c.req.header("host") || c.req.header("Host");
	let protocol = "https"; // Default to https
	const forwardedProto = c.req.header("x-forwarded-proto");
	if (forwardedProto) {
		protocol = forwardedProto.split(",")[0]; // In case of multiple values
	}
	return {
		protocol,
		domain: host ? host.split(":")[0] : "localhost",
	};
}
