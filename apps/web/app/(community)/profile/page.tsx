import {SiteHeader} from '../../../components/site-header';
import {Runtime} from '../../../components/runtime';
export default function Page() {
  return <><SiteHeader section="/profile"/><div id="app"><p className="boot" role="status">Opening Poros…</p></div><div id="notifications" aria-live="polite" aria-atomic="true"/><Runtime/></>;
}
