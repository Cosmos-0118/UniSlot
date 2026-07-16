import { LegalDocumentPage } from '@/features/landing/LegalDocumentPage'

export function PrivacyPage() {
  return (
    <LegalDocumentPage
      eyebrow="Legal"
      title="Privacy Policy"
      lastUpdated="July 16, 2026"
      intro="UniSlot is built to keep your scheduling work local. This policy explains what information is involved when you use the app and how we treat it."
      related={{ to: '/terms', label: 'Terms of Service' }}
      sections={[
        {
          heading: 'Local-first processing',
          body: (
            <p>
              UniSlot runs in your browser. Enrollment workbooks, schedules, clash reports, and related
              session data are processed on your device. We do not operate a UniSlot cloud account that
              stores your uploaded files for scheduling.
            </p>
          ),
        },
        {
          heading: 'Information stored on your device',
          body: (
            <>
              <p>Depending on how you use the app, the following may be stored in your browser:</p>
              <ul>
                <li>Theme preference and similar UI settings</li>
                <li>Saved scheduling runs and export-related data you choose to keep locally</li>
                <li>Transient session state while you work in the scheduler</li>
              </ul>
              <p>
                Clearing site data for UniSlot in your browser removes this locally stored information.
              </p>
            </>
          ),
        },
        {
          heading: 'What we do not collect',
          body: (
            <p>
              UniSlot does not require you to create an account, and it does not intentionally upload your
              enrollment files or generated timetables to UniSlot servers as part of normal scheduling.
              Content you download (for example Excel exports) remains under your control.
            </p>
          ),
        },
        {
          heading: 'Third-party services',
          body: (
            <p>
              Hosting or analytics tools used to deliver the website may receive standard technical data
              such as IP address, browser type, and page requests. That data is governed by the providers
              of those services, not by UniSlot scheduling logic itself.
            </p>
          ),
        },
        {
          heading: 'Your choices',
          body: (
            <p>
              You can stop using the app at any time, clear local storage, and avoid uploading sensitive
              files if your institution&apos;s policies require additional safeguards. For institutional
              data, follow your organization&apos;s privacy and retention rules.
            </p>
          ),
        },
        {
          heading: 'Contact',
          body: (
            <p>
              Questions about this policy can be directed to the UniSlot project maintainers through the
              channels published with your deployment or course project materials.
            </p>
          ),
        },
      ]}
    />
  )
}
