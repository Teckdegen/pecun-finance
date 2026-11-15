import type { Metadata } from "next";
import { A, Callout, Doc, H2, List, P } from "@/components/chrome";
import { UNSUPPORTED_REGIONS } from "@/lib/site";

export const metadata: Metadata = { title: "Availability", description: "Where Pecun is and isn't available." };

export default function Availability() {
  return (
    <Doc href="/availability">
      <P>
        Pecun is available in most of the world, but not everywhere. You must be at least 18, not on any sanctions list, and not a resident of or
        located in any of the regions below.
      </P>

      <H2>Regions Pecun doesn&apos;t serve</H2>
      <List items={UNSUPPORTED_REGIONS} />

      <Callout title="The Terms decide">
        This list follows the <A href="/terms">Terms of Service</A>, which have the final word and can change. Using a VPN or other tools to
        get around these restrictions isn&apos;t allowed.
      </Callout>
    </Doc>
  );
}
