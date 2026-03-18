import type { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, CacheType } from 'discord.js'
import type { HarmoniaClient } from '../client'

export interface Command {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'> | any
  cooldown?: number
  djOnly?: boolean
  voiceOnly?: boolean
  execute: (client: HarmoniaClient, interaction: ChatInputCommandInteraction<CacheType>) => Promise<any>
  autocomplete?: (client: HarmoniaClient, interaction: AutocompleteInteraction) => Promise<void>
}

export interface Event {
  name: string
  once?: boolean
  emitter?: 'client' | 'kazagumo'
  execute: (client: HarmoniaClient, ...args: any[]) => Promise<void> | void
}
