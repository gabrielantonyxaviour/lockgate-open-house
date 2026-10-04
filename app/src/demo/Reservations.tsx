import { Button, money, Rows } from './Common';
import type { DemoGateway, DemoState } from './types';

export function Reservations({state,gateway,run,busy,refresh}:{
 state:DemoState;gateway:DemoGateway;run:<T>(task:()=>Promise<T>)=>Promise<T>;busy:boolean;refresh:()=>Promise<void>;
}) {
 if(!state.reservations?.length)return null;
 return <section className="dg-panel dg-reservations"><h2>Reserved exits</h2><p>Release an unfinished exit to make its position and cash available again.</p>
  {state.reservations.map(reservation=><article key={reservation.digest}>
   <h3>{reservation.firm}</h3><Rows items={[["Position reserved",`${money(reservation.units)} units`],["Payout reserved",`${money(reservation.payout)} USDG`],["Expires",reservation.expiresAt]]}/>
   <Button secondary busy={busy} onClick={()=>void run(async()=>{await gateway.releaseReservation(reservation.digest);await refresh();}).catch(()=>{})}>Release reservation</Button>
  </article>)}
 </section>;
}
