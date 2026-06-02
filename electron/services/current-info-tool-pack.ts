import { toolRegistry } from './tool-registry'
import {
  executeFinanceQuote,
  executeWeatherLookup,
  executeSportsLookup,
  type FinanceQuoteArgs,
  type WeatherLookupArgs,
  type SportsLookupArgs
} from './current-info-tools'

toolRegistry.registerNative(
  {
    id: 'finance_quote',
    name: 'finance_quote',
    title: 'Finance quote',
    description:
      'Look up a current stock or crypto quote by symbol (e.g. "AAPL", "MSFT", "BTC-USD"). Returns price, change, open/high/low and the source. Provider defaults to the user-configured Finnhub or Alpha Vantage; pass "provider" to override. Returns "Error: ..." if no provider key is configured.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Ticker symbol, e.g. "AAPL" or "BTC-USD".'
        },
        provider: {
          type: 'string',
          enum: ['finnhub', 'alphavantage'],
          description: 'Optional override of the configured provider.'
        }
      },
      required: ['symbol']
    },
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeFinanceQuote(args as unknown as FinanceQuoteArgs)
)

toolRegistry.registerNative(
  {
    id: 'weather_lookup',
    name: 'weather_lookup',
    title: 'Weather lookup',
    description:
      'Get current weather for a location (city, "lat,lon", or place name). Default provider is Open-Meteo (no key required). OpenWeatherMap is supported when configured. Returns temperature, condition, humidity, and wind with the source.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name, place, or "lat,lon" pair.'
        },
        units: {
          type: 'string',
          enum: ['metric', 'imperial'],
          description: 'Optional unit system. Defaults to metric.'
        }
      },
      required: ['location']
    },
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeWeatherLookup(args as unknown as WeatherLookupArgs)
)

toolRegistry.registerNative(
  {
    id: 'sports_lookup',
    name: 'sports_lookup',
    title: 'Sports lookup',
    description:
      'Look up sports team info, leagues, or recent/upcoming events via TheSportsDB (free, no key). Use kind="team" for a team profile, "league" for a league summary, "next" for the next event (default), or "last" for the most recent finished event.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Team or league name (e.g. "Arsenal", "Lakers", "NBA").'
        },
        kind: {
          type: 'string',
          enum: ['team', 'league', 'next', 'last'],
          description:
            'What to return. Defaults to "next" (next scheduled event for the matched team).'
        }
      },
      required: ['query']
    },
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeSportsLookup(args as unknown as SportsLookupArgs)
)
