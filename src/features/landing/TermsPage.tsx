import { LegalDocumentPage } from '@/features/landing/LegalDocumentPage'
import { Link } from 'react-router-dom'

export function TermsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Legal"
      title="Terms of Service"
      lastUpdated="July 16, 2026"
      intro="These terms describe the conditions under which you may use UniSlot. By using the app, you agree to them."
      related={{ to: '/privacy', label: 'Privacy Policy' }}
      sections={[
        {
          heading: 'What UniSlot is',
          body: (
            <p>
              UniSlot is a browser-based scheduling tool that helps process enrollment workbooks, surface
              clashes, and build evening timetables with exportable results. It is provided as a software
              project for academic and institutional scheduling workflows.
            </p>
          ),
        },
        {
          heading: 'Acceptable use',
          body: (
            <>
              <p>You agree to use UniSlot only for lawful purposes and in ways that respect:</p>
              <ul>
                <li>Your institution&apos;s data handling and student privacy policies</li>
                <li>Intellectual property and confidentiality of any files you process</li>
                <li>The integrity of the application (no attempts to disrupt or misuse shared hosting)</li>
              </ul>
            </>
          ),
        },
        {
          heading: 'Your responsibility for inputs and outputs',
          body: (
            <p>
              You are responsible for the accuracy of the data you provide and for validating generated
              schedules before they are used operationally. UniSlot assists scheduling decisions; it does
              not replace institutional review, academic policy, or human judgment.
            </p>
          ),
        },
        {
          heading: 'No warranty',
          body: (
            <p>
              UniSlot is provided &quot;as is&quot; without warranties of any kind, express or implied,
              including fitness for a particular purpose or uninterrupted availability. Scheduling results
              may contain errors or incomplete assignments depending on inputs and constraints.
            </p>
          ),
        },
        {
          heading: 'Limitation of liability',
          body: (
            <p>
              To the fullest extent permitted by law, the UniSlot authors and distributors are not liable
              for any indirect, incidental, or consequential damages arising from use of the app, including
              decisions made from exported schedules or clash reports.
            </p>
          ),
        },
        {
          heading: 'Changes',
          body: (
            <p>
              These terms may be updated as the project evolves. Continued use after changes are posted on
              this page constitutes acceptance of the revised terms. The &quot;Last updated&quot; date at
              the top of this page reflects the latest revision.
            </p>
          ),
        },
        {
          heading: 'Related policy',
          body: (
            <p>
              How UniSlot handles information is described in the{' '}
              <Link to="/privacy">Privacy Policy</Link>.
            </p>
          ),
        },
      ]}
    />
  )
}
