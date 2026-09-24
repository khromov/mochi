export interface CodeSample {
  file: string;
  lang: 'svelte' | 'ts' | 'html' | 'bash';
  code: string;
}

export const serve: CodeSample = {
  file: 'src/index.ts',
  lang: 'ts',
  code: `import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3000,
  routes: {
    '/': Mochi.page('./src/Home.svelte', {
      serverProps: async () => ({ posts: await loadPosts() }),
    }),
  },
});`,
};

export const page: CodeSample = {
  file: 'src/Home.svelte',
  lang: 'svelte',
  code: `<script lang="ts">
  import Counter from './Counter.svelte';

  let { posts } = $props();
</script>

<h1>Latest posts</h1>
<ul>
  {#each posts as post (post.slug)}
    <li><a href="/posts/{post.slug}/">{post.title}</a></li>
  {/each}
</ul>

<Counter mochi:hydrate count={5} />`,
};

export const counter: CodeSample = {
  file: 'src/Counter.svelte',
  lang: 'svelte',
  code: `<script lang="ts">
  let { count = 0 } = $props();
</script>

<button onclick={() => count++}>
  Clicked {count} times
</button>`,
};

export const island: CodeSample = {
  file: 'src/Home.svelte',
  lang: 'svelte',
  code: `<Header />
<Counter mochi:hydrate count={5} />
<Footer />`,
};

export const hydrationModes: CodeSample = {
  file: 'src/Home.svelte',
  lang: 'svelte',
  code: `<Counter mochi:hydrate />
<HeavyChart mochi:hydrate:visible />
<UserAvatar mochi:defer />
<Comments mochi:defer:visible />`,
};

export const lazy: CodeSample = {
  file: 'src/Home.svelte',
  lang: 'svelte',
  code: `<HeavyChart mochi:hydrate:visible={{ rootMargin: '200px' }} />`,
};

export const defer: CodeSample = {
  file: 'src/Home.svelte',
  lang: 'svelte',
  code: `<UserAvatar mochi:defer userId={123}>
  <div class="skeleton">Loading...</div>
</UserAvatar>`,
};

export const serverIsland: CodeSample = {
  file: 'src/UserAvatar.svelte',
  lang: 'svelte',
  code: `<script lang="ts">
  import { getRequestContext } from 'mochi-framework';

  const { cookies } = getRequestContext();
  const userName = cookies.get('user') ?? 'friend';
</script>

<p>Welcome back, {userName}!</p>`,
};

export const forms: CodeSample = {
  file: 'src/index.ts',
  lang: 'ts',
  code: `'/login': Mochi.page('./src/Login.svelte', {
  actions: {
    login: ({ formData }) => {
      const username = String(formData.get('username') ?? '');
      if (!username) return fail(400, { error: 'Username required' });
      return success({ username });
    },
  },
}),`,
};

export const loginForm: CodeSample = {
  file: 'src/Login.svelte',
  lang: 'svelte',
  code: `<form method="POST" action="?/login">
  <input name="username" />
  <button>Log in</button>
</form>`,
};

export const websocket: CodeSample = {
  file: 'src/index.ts',
  lang: 'ts',
  code: `'/ws/chat': Mochi.ws({
  open(ws) {
    ws.subscribe('chat');
  },
  message(ws, message) {
    ws.publish('chat', String(message));
  },
}),`,
};

export const sse: CodeSample = {
  file: 'src/index.ts',
  lang: 'ts',
  code: `'/sse/time': Mochi.sse((stream) => {
  const timer = setInterval(() => stream.send(new Date().toISOString()), 1000);
  stream.onClose(() => clearInterval(timer));
}),`,
};

export const cache: CodeSample = {
  file: 'src/lib/cache.ts',
  lang: 'ts',
  code: `import { MochiCache } from 'mochi-framework';

export const pokemonCache = new MochiCache({
  minTimeToStale: 10_000,
  maxTimeToLive: 300_000,
});

const pokemon = await pokemonCache.fetch('pokemon:pikachu', loadPokemon);`,
};

export const create: CodeSample = {
  file: 'terminal',
  lang: 'bash',
  code: 'bun create mochi@latest',
};
