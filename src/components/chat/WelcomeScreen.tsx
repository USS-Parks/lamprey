import startupLightUrl from '@assets/Lamprey Startup Light.png'
import startupDarkUrl from '@assets/Lamprey Startup Dark.png'

export function WelcomeScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <span className="relative mb-6 flex h-40 w-40 items-center justify-center">
          <img
            src={startupLightUrl}
            alt=""
            aria-hidden
            className="themed-variant-light icon-asset h-40 w-40 object-contain"
          />
          <img
            src={startupDarkUrl}
            alt=""
            aria-hidden
            className="themed-variant-dark icon-asset h-40 w-40 object-contain"
          />
        </span>
        <h1 className="font-mono text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Lamprey MAI
        </h1>
        <h2 className="mt-3 text-sm font-normal text-[var(--text-secondary)]">
          Let's get to work
        </h2>
      </div>
    </div>
  )
}
