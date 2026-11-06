import {SiteHeader} from '../../components/site-header';
import {Runtime} from '../../components/runtime';
import {tradeMarkup} from '../../components/trade-markup';
export default function TradePage() {
  return <><SiteHeader section="/"/><div id="main" tabIndex={-1} dangerouslySetInnerHTML={{__html: tradeMarkup}}/><Runtime trade/></>;
}
