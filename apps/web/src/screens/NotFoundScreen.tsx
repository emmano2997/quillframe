import { Screen } from '../app/Screen.tsx'
import { en } from '../strings/en.ts'
import { ButtonLink, Panel, ui } from '../ui/kit.tsx'

export function NotFoundScreen() {
  return (
    <Screen title={en.notFound.title} back="/">
      <Panel>
        <p className={`${ui.text} ${ui.center}`}>{en.notFound.message}</p>
        <div className={ui.row}>
          <ButtonLink to="/">{en.common.backToTitle}</ButtonLink>
        </div>
      </Panel>
    </Screen>
  )
}
