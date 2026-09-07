<script lang="ts">
	import { page } from '$app/state';
	import AppDialog from './AppDialog.svelte';

	let {
		open = $bindable(false),
		sessionId = '',
		sessionError = ''
	}: { open: boolean; sessionId?: string; sessionError?: string } = $props();
	type ConnectionSnippet = { id: string; label: string; value: string };
	let copiedConnectionId = $state('');
	let copyError = $state('');
	$effect(() => {
		if (!open) {
			copiedConnectionId = '';
			copyError = '';
		}
	});
	const mcpURL = $derived(new URL('/mcp', page.url.origin).toString());
	const connectionSnippets = $derived([
		{
			id: 'url',
			label: 'MCP アドレス',
			value: mcpURL
		},
		...(sessionId ? [{ id: 'session-id', label: 'セッション ID', value: sessionId }] : []),
		{
			id: 'chatgpt',
			label: 'ChatGPT',
			value: [
				'Name: Betterzeriya',
				`MCP URL: ${mcpURL}`,
				'Authentication: None',
				'Transport: Streamable HTTP'
			].join('\n')
		},
		{
			id: 'codex-config',
			label: 'Codex',
			value: [
				`[mcp_servers.betterzeriya]`,
				`url = "${mcpURL}"`,
				`default_tools_approval_mode = "prompt"`
			].join('\n')
		},
		{
			id: 'claude-code',
			label: 'Claude Code',
			value: `claude mcp add --transport http betterzeriya ${mcpURL}`
		},
		{
			id: 'claude-json',
			label: 'Claude Code JSON',
			value: JSON.stringify(
				{
					mcpServers: {
						betterzeriya: {
							type: 'http',
							url: mcpURL
						}
					}
				},
				null,
				2
			)
		}
	] satisfies ConnectionSnippet[]);

	const copyText = async (value: string) => {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
			return;
		}

		const textarea = document.createElement('textarea');
		textarea.value = value;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.append(textarea);
		textarea.select();
		const copied = document.execCommand('copy');
		textarea.remove();
		if (!copied) {
			throw new Error('文字列を選択してコピーしてください。');
		}
	};

	const copyConnectionSnippet = async (snippet: ConnectionSnippet) => {
		copyError = '';
		try {
			await copyText(snippet.value);
			copiedConnectionId = snippet.id;
		} catch (caught) {
			copyError = caught instanceof Error ? caught.message : 'コピーに失敗しました';
		}
	};
</script>

<AppDialog bind:open eyebrow="MCP" title="MCP 接続情報">
	<p class="m-0 text-sm leading-relaxed text-slate-600">MCP アドレスを接続先に登録し、使うときに AI へセッション ID を伝えてください。</p>
	{#if !sessionId}
		<p class="m-0 rounded-lg bg-green-50 p-3 text-sm text-green-800">セッション ID は、テーブルの QR コードを読み取ると表示されます。</p>
	{/if}
	{#if copyError}
		<p class="m-0 text-sm text-red-800" role="alert">{copyError}</p>
	{/if}
	{#if sessionError}
		<p class="m-0 text-sm text-red-800" role="alert">{sessionError}</p>
	{/if}
	<div class="mcp-connection-shell">
		{#each connectionSnippets as snippet}
			<section class="mcp-connection-card">
				<div class="flex items-center justify-between gap-2">
					<strong class="text-sm">{snippet.label}</strong>
					<button class="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-[var(--mcp-ink)] px-3 text-xs font-extrabold text-white transition hover:-translate-y-px focus:ring-4 focus:ring-green-500/20" type="button" aria-label={`${snippet.label}をコピー`} onclick={() => copyConnectionSnippet(snippet)}>
						<span class={copiedConnectionId === snippet.id ? 'i-tabler-check text-base' : 'i-tabler-copy text-base'}></span>
						{copiedConnectionId === snippet.id ? 'コピー済み' : 'コピー'}
					</button>
				</div>
				<pre class="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-900/10 bg-white/85 p-3 text-[12px] leading-relaxed whitespace-pre-wrap break-all text-slate-800">{snippet.value}</pre>
			</section>
		{/each}
	</div>
</AppDialog>

<style>
	.mcp-connection-shell {
		--mcp-main: #159a63;
		--mcp-accent: #ffb000;
		--mcp-ink: #101827;
		position: relative;
		display: grid;
		gap: 0.75rem;
		overflow: hidden;
		border-radius: 8px;
		padding: 0.75rem;
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--mcp-main) 18%, transparent), transparent 42%),
			linear-gradient(315deg, color-mix(in srgb, var(--mcp-accent) 22%, transparent), transparent 44%),
			#f8fafc;
	}

	.mcp-connection-shell::before {
		position: absolute;
		inset: 0;
		pointer-events: none;
		content: '';
		background-image: linear-gradient(
			115deg,
			transparent 0 28%,
			rgba(255, 255, 255, 0.42) 33%,
			transparent 40% 100%
		);
		animation: mcp-sheen 5.5s linear infinite;
	}

	.mcp-connection-card {
		position: relative;
		z-index: 1;
		border: 1px solid color-mix(in srgb, var(--mcp-ink) 12%, transparent);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.72);
		padding: 0.75rem;
		box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
	}

	@keyframes mcp-sheen {
		from {
			transform: translateX(-140%);
		}

		to {
			transform: translateX(140%);
		}
	}
</style>
