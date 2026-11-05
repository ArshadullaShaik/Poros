export async function connectBrowserWallet(provider=globalThis.ethereum){
  if(!provider?.request)throw new Error("Install or open a browser wallet, then connect it.");
  const accounts=await provider.request({method:"eth_requestAccounts"});
  if(!/^0x[0-9a-fA-F]{40}$/.test(accounts?.[0]??""))throw new Error("The wallet did not provide an account.");
  if(await provider.request({method:"eth_chainId"})!=="0x2105")await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x2105"}]});
  if(await provider.request({method:"eth_chainId"})!=="0x2105")throw new Error("Switch your wallet to Base mainnet.");
  return accounts[0];
}
export async function signFlashOrder(request,signal,provider=globalThis.ethereum){
  async function check(){
    signal?.throwIfAborted();
    const accounts=await provider.request({method:"eth_accounts"});
    if(accounts?.[0]?.toLowerCase()!==request.funderAddress?.toLowerCase()||await provider.request({method:"eth_chainId"})!=="0x2105")throw new Error("Wallet account or network changed. Start a new run.");
    if(Date.now()+10000>=request.deadlineMs)throw new Error("Flash quote expired. Start a new run.");
  }
  await check();
  if(request.approveTx){
    const hash=await provider.request({method:"eth_sendTransaction",params:[{from:request.funderAddress,to:request.approveTx.to,data:request.approveTx.data,value:"0x0"}]});
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("Wallet returned an invalid approval transaction hash.");
    while(true){
      await check();
      const receipt=await provider.request({method:"eth_getTransactionReceipt",params:[hash]});
      if(receipt){if(receipt.status!=="0x1")throw new Error("Token approval failed. No Flash order was submitted.");break;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  await check();
  const signature=await provider.request({method:"eth_signTypedData_v4",params:[request.funderAddress,request.typedData]});
  await check();
  if(!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new Error("This wallet did not return a supported EOA signature. Smart-wallet signature adapters are not configured.");
  return signature;
}
