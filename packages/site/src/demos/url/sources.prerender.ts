import { loadSources } from '../../components/utils.ts';
import { files } from './files.ts';

export const sources = await loadSources(files);
