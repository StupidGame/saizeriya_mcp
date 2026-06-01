import { describe, expect, it } from 'vite-plus/test'
import { normalizeMenuName } from './menu-name-normalization'
import { buildPersonaPrompt, buildSystemPrompt, normalizeCustomPersona } from './system-prompt'

describe('zeriyaGPT system prompt', () => {
  it('normalizes menu names with Unicode compatibility forms', () => {
    expect(normalizeMenuName('　ﾗﾝﾁ)ﾊﾟﾙﾏ風ｽﾊﾟｹﾞｯﾃｨ\u200B ')).toBe('ランチ)パルマ風スパゲッティ')
    expect(normalizeMenuName('ＡＢＣ１２３　小ｴﾋﾞのｻﾗﾀﾞ')).toBe('ABC123 小エビのサラダ')
  })

  it('keeps the base system prompt unchanged when no persona is provided', () => {
    expect(buildSystemPrompt()).not.toContain('カスタムペルソナ')
    expect(buildPersonaPrompt()).toBe('')
  })

  it('builds a separate persona prompt', () => {
    expect(buildPersonaPrompt('  落ち着いたソムリエとして短く答える  ')).toBe(
      'カスタムペルソナ:\n既存のルールを守ったまま、以下の人物像・口調で応答してください。\n落ち着いたソムリエとして短く答える',
    )
  })

  it('limits custom persona text length', () => {
    expect(normalizeCustomPersona('x'.repeat(1300))).toHaveLength(1200)
  })
})
