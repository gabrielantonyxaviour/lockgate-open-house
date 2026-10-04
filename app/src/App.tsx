import { useState } from 'react';
import { DemoApp } from './demo/DemoApp';
import { createDemoGateway } from './services/demo-gateway';
export default function App() {
 const [gateway]=useState(createDemoGateway);
 return <DemoApp gateway={gateway}/>;
}
