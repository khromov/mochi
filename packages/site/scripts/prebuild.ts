// Run both barrel generators concurrently in one process instead of two
// sequential `bun` invocations (saves a process startup plus the serial run).
import { generateDocsBarrel } from '../src/lib/generateDocsBarrel';
import { generateBlogBarrel } from '../src/lib/generateBlogBarrel';

await Promise.all([generateDocsBarrel(), generateBlogBarrel()]);
