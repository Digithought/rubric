/**
 * Split a feature list into batches per the aspect's batch size.
 */

export function batchFeatures(features, batchSize) {
	const size = Math.max(1, batchSize | 0 || 8);
	const out = [];
	for (let i = 0; i < features.length; i += size) {
		out.push(features.slice(i, i + size));
	}
	return out;
}
