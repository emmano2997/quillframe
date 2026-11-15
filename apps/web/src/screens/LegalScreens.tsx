// Community Guidelines, Terms of Use e Privacy Policy (documento 03, §9, e documento 02, §7.8).
// São páginas de texto do próprio site: nada aqui vem de usuários.
import { TERMS_VERSION } from '@quillframe/shared'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Screen } from '../app/Screen.tsx'
import { en } from '../strings/en.ts'
import { ui } from '../ui/kit.tsx'

function Prose({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Screen title={title} wide>
      <article className={`${ui.prose} ${ui.readable}`}>{children}</article>
    </Screen>
  )
}

const Version = () => <p>Version: {TERMS_VERSION}</p>

export function GuidelinesScreen() {
  return (
    <Prose title={en.nav.guidelines}>
      <h1>quillframe Community Guidelines</h1>
      <p>
        quillframe is a place to write, animate and share books. These rules keep it safe and welcoming for everyone. They apply
        to everything you publish: books (text and ASCII art), titles, usernames and bios.
      </p>
      <p>
        <strong>You must be 16 or older to use quillframe.</strong>
      </p>

      <h2>1. No sexual content</h2>
      <ul>
        <li>No sexually explicit or suggestive content, in text or in ASCII art.</li>
        <li>No nudity, sexual acts, sexual roleplay or fetish content.</li>
        <li>No references or directions to sexual content elsewhere.</li>
      </ul>

      <h2>2. Zero tolerance for anything that sexualizes minors</h2>
      <p>
        Any content that sexualizes, exploits or endangers children or teenagers is removed immediately. The account is permanently
        banned and the case is reported to the authorities.
      </p>

      <h2>3. Be respectful</h2>
      <ul>
        <li>
          No hate speech or attacks based on race, ethnicity, nationality, religion, sex, gender identity, sexual orientation,
          disability or any similar characteristic.
        </li>
        <li>No harassment, bullying or threats, including books or titles made to target someone.</li>
      </ul>

      <h2>4. Keep it safe</h2>
      <ul>
        <li>
          No content that encourages or glorifies self-harm, suicide or eating disorders. Stories can deal with hard topics, but must
          not promote them.
        </li>
        <li>No graphic gore and no content that promotes violence, terrorism or dangerous challenges.</li>
        <li>No content that promotes illegal activities, drugs or weapons.</li>
      </ul>
      <p>
        If you are going through a hard time, please reach out. In Brazil, call CVV at 188 or visit cvv.org.br. Elsewhere, contact
        your local emergency services.
      </p>

      <h2>5. Protect privacy</h2>
      <ul>
        <li>
          Don&apos;t share personal information, yours or anyone else&apos;s: full names, addresses, phone numbers, emails, schools,
          passwords or social media accounts.
        </li>
        <li>Don&apos;t share private conversations about other people.</li>
      </ul>

      <h2>6. Be honest</h2>
      <ul>
        <li>No spam, scams, advertising or misleading titles.</li>
        <li>Don&apos;t pretend to be another person, creator, moderator or the quillframe team.</li>
        <li>Don&apos;t create another account to get around a suspension or ban.</li>
      </ul>

      <h2>7. Respect creators</h2>
      <ul>
        <li>Publish your own work. Don&apos;t upload other people&apos;s books or art without permission.</li>
        <li>&quot;Make a Copy&quot; always keeps the original author. Never present a copy as your own.</li>
      </ul>

      <h2>8. quillframe is not Minecraft</h2>
      <p>quillframe is a fan project. Don&apos;t claim it is made, approved or endorsed by Mojang or Microsoft.</p>

      <h2>Reporting</h2>
      <p>
        Use <strong>Report</strong> on any book or profile. Choose a reason and, if you can, the page. Reports are confidential: the
        person you report never sees who reported them. Reporting in bad faith, to harass someone or to remove content you simply
        don&apos;t like, also breaks these rules.
      </p>
      <p>
        If you are a victim, a parent or guardian, or an organization reporting content that violates the rights of a child or
        teenager, you can use the <Link to="/report-concern">Report a Concern</Link> form. No account needed.
      </p>

      <h2>What happens when rules are broken</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Situation</th>
            <th scope="col">Consequence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>First minor violation</td>
            <td>Warning</td>
          </tr>
          <tr>
            <td>Violation</td>
            <td>Content removed + 1 strike (strikes expire after 90 days)</td>
          </tr>
          <tr>
            <td>2 active strikes</td>
            <td>3-day suspension</td>
          </tr>
          <tr>
            <td>3 active strikes</td>
            <td>30-day suspension</td>
          </tr>
          <tr>
            <td>4 active strikes</td>
            <td>Permanent ban</td>
          </tr>
          <tr>
            <td>Sexual content involving minors, real threats, spam bots, ban evasion</td>
            <td>Immediate permanent ban</td>
          </tr>
        </tbody>
      </table>
      <p>
        A book may be hidden while it is reviewed. When we act on your content, we tell you which rule it broke, whether the
        decision was automated or made by a moderator, and how to appeal.
      </p>

      <h2>Appeals</h2>
      <p>
        You can appeal any decision within 30 days, from your notifications or from{' '}
        <Link to="/settings/moderation">Options → Moderation History</Link>. A moderator will review it, usually within 7 days.
      </p>
    </Prose>
  )
}

export function TermsScreen() {
  return (
    <Prose title={en.nav.terms}>
      <h1>Terms of Use</h1>
      <Version />
      <p>
        <a href="#pt">Versão em português (resumo)</a>
      </p>

      <h2>1. What quillframe is</h2>
      <p>
        quillframe is a free, non-commercial fan project where you write, animate and share books in the style of a book and quill.
        It is not an official Minecraft product and is not approved by or associated with Mojang or Microsoft.
      </p>

      <h2>2. Who can use it</h2>
      <p>
        You must be at least 16 years old. If you are 16 or 17, some privacy protections are always on. One person, one account:
        don&apos;t create accounts to get around a suspension or ban.
      </p>

      <h2>3. Your account</h2>
      <p>
        Keep your password to yourself and use a unique one. Tell us if you think someone else got into your account. You are
        responsible for what is published from it.
      </p>

      <h2>4. Your content</h2>
      <p>
        Your books are yours. By sharing a book with friends or publishing it to the Community, you allow quillframe to store it and
        show it to the people you chose, and you allow other users to keep a copy inside quillframe when &quot;Allow copies&quot; is
        on. Copies always show you as the author and disappear if you make the book private or delete it. You can export or delete
        your books at any time.
      </p>
      <p>Only publish work that is yours or that you have permission to publish.</p>

      <h2>5. Rules</h2>
      <p>
        Everything you publish must follow the <Link to="/guidelines">Community Guidelines</Link>. We may hide or remove content and
        warn, suspend or ban accounts that break them. We always tell you which rule was broken, whether the decision was automated,
        and how to appeal.
      </p>

      <h2>6. The service</h2>
      <p>
        quillframe is provided as it is, without guarantees of availability. We may change or end the service; if we do, we will
        give you time to export your books. To the extent the law allows, we are not liable for losses caused by using the site.
      </p>

      <h2>7. Changes to these terms</h2>
      <p>If these terms change in a relevant way, we will ask you to accept them again the next time you sign in.</p>

      <h2>8. Law and contact</h2>
      <p>
        These terms are governed by the laws of Brazil. Questions about them, or about your data, can be sent to the privacy contact
        listed in the <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <h2 id="pt">Resumo em português</h2>
      <p>
        O quillframe é um projeto de fãs, gratuito e sem fins lucrativos, para escrever, animar e compartilhar livros. Não é um
        produto oficial do Minecraft. É preciso ter 16 anos ou mais. Os livros são seus: ao compartilhar, você autoriza o site a
        guardá-los e mostrá-los a quem você escolheu, e pode exportá-los ou apagá-los quando quiser. Tudo o que é publicado segue as
        Diretrizes da Comunidade; quando agimos sobre um conteúdo, informamos a regra, se a decisão foi automática e como recorrer.
        O serviço é oferecido como está. Estes termos seguem a lei brasileira.
      </p>
    </Prose>
  )
}

export function PrivacyScreen() {
  return (
    <Prose title={en.nav.privacy}>
      <h1>Privacy Policy</h1>
      <Version />
      <p>
        <a href="#pt">Versão em português (resumo)</a>
      </p>

      <h2>What we collect and why</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Why</th>
            <th scope="col">How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Email</td>
            <td>Signing in, account recovery, security notices</td>
            <td>While the account exists</td>
          </tr>
          <tr>
            <td>Username</td>
            <td>Your public identity and authorship</td>
            <td>While the account exists, plus 90 days reserved</td>
          </tr>
          <tr>
            <td>Date of birth</td>
            <td>The age rule (16+) and the protections for ages 16–17</td>
            <td>While the account exists</td>
          </tr>
          <tr>
            <td>Password</td>
            <td>Signing in. Stored only as a one-way hash; we can never read it</td>
            <td>While the account exists</td>
          </tr>
          <tr>
            <td>IP address and browser</td>
            <td>Security, fraud prevention and access records</td>
            <td>6 months</td>
          </tr>
          <tr>
            <td>Books, likes, favorites, friendships</td>
            <td>The service itself</td>
            <td>Until you delete them</td>
          </tr>
          <tr>
            <td>Reports</td>
            <td>Moderation</td>
            <td>1 year after they are resolved</td>
          </tr>
          <tr>
            <td>Two-factor secret and recovery codes</td>
            <td>Two-factor authentication. The secret is encrypted; the codes are stored as hashes</td>
            <td>Until you turn it off</td>
          </tr>
        </tbody>
      </table>
      <p>We do not sell data, show ads or send marketing email.</p>

      <h2>Cookies</h2>
      <p>
        Only essential cookies: your session, protection against cross-site request forgery, and the short-lived cookies used during
        two-factor and Google/Discord sign-in. There are no analytics or advertising cookies, so there is no consent banner. The
        forms that need a bot check load Cloudflare Turnstile, which may set its own cookie.
      </p>
      <p>
        Your interface preferences (GUI scale, sounds, recent symbols) are kept in your browser only and are never sent to us.
      </p>

      <h2>Who we share data with</h2>
      <p>
        Only the services that run the site: hosting, database, email delivery and Cloudflare (network protection and the bot
        check). When you choose to sign in with Google or Discord, we receive your account identifier and verified email from them.
        We report content that sexualizes minors to the authorities, as the law requires.
      </p>

      <h2>Ages 16 and 17</h2>
      <p>
        If you are 16 or 17, you do not appear in user search, only friends of friends can send you friend requests, and your
        favorites are hidden. These protections end automatically when you turn 18.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>Access and portability:</strong> Options → Data → &quot;Export My Data&quot; gives you a ZIP file with your
          profile, books and activity.
        </li>
        <li>
          <strong>Correction:</strong> Options → Account.
        </li>
        <li>
          <strong>Deletion:</strong> Options → Data → &quot;Delete Account&quot;. Your profile and books disappear at once; after 30
          days everything is erased, except what the law requires us to keep.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Passwords are hashed with Argon2id and an extra secret kept outside the database. Sessions and email links are stored only as
        hashes. If a security incident puts your data at risk, we will tell you and the Brazilian data protection authority (ANPD).
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions and requests: use the contact published at <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
      </p>

      <h2 id="pt">Resumo em português</h2>
      <p>
        Coletamos o mínimo: e-mail, nome de usuário, data de nascimento, senha (guardada só como hash), IP e navegador (por 6 meses,
        para segurança) e o que você cria no site. Não vendemos dados, não há anúncios nem rastreadores. Usamos apenas cookies
        essenciais. Quem tem 16 ou 17 anos fica com proteções de privacidade ligadas até os 18. Você pode exportar seus dados,
        corrigi-los e excluir a conta em Options → Data, conforme a LGPD (art. 18).
      </p>
    </Prose>
  )
}
