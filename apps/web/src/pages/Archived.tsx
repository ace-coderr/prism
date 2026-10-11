import { Link } from 'react-router-dom';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { GuideNote } from '../components/Viber';

/** Old v1 links (/forge, /my-crystals, /gift/…, /replay/…, /claim/…): a short note, never a 404. */
export default function Archived() {
  return (
    <PageScroll>
      <PageHeader
        label="PRISM v1"
        lead="PRISM v1 has been"
        accent="archived."
        subtitle="This link was part of the first PRISM (crystals). PRISM is now a review site where only holders can review a launch, and selling shows."
        guide={
          <GuideNote
            index={2}
            action={
              <>
                <Link to="/" className="btn btn-primary">
                  See the new PRISM
                </Link>
                <Link to="/legacy" className="btn btn-outline">
                  I have a v1 crystal
                </Link>
              </>
            }
          >
            Holding a v1 crystal? It’s still yours, with everything inside it. Empty it any time to get it all back.
          </GuideNote>
        }
      />
    </PageScroll>
  );
}
