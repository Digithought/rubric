import type {
	FeatureNode,
	FeatureDetail,
	AspectSummary,
	AspectDetail,
	RunSummary,
	RunDetail,
	CoverageData,
} from './types.js';

async function get<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.json();
}

export const api = {
	features: () => get<FeatureNode[]>('/api/features'),
	feature: (path: string) => get<FeatureDetail>(`/api/features/${encodePath(path)}`),
	aspects: () => get<AspectSummary[]>('/api/aspects'),
	aspect: (name: string) => get<AspectDetail>(`/api/aspects/${encodeURIComponent(name)}`),
	defaultAspects: () => get<string[]>('/api/defaults/aspects'),
	runs: () => get<RunSummary[]>('/api/runs'),
	run: (filename: string) => get<RunDetail>(`/api/runs/${encodeURIComponent(filename)}`),
	coverage: () => get<CoverageData>('/api/coverage'),
};

// Encode each path segment, preserving slashes between them so the server can
// see the full nested path.
function encodePath(p: string): string {
	return p.split('/').map(encodeURIComponent).join('/');
}
