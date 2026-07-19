export default ([
  
  'ca-central-1',
  
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  
  // TODO: Need to return an exhaustive list...
  // 'af-south-1',
  // 'ap-east-1',
  // 'ap-east-2',
  // 'ap-northeast-1',
  // 'ap-northeast-2',
  // 'ap-northeast-3',
  // 'ap-south-1',
  // 'ap-south-2',
  // 'ap-southeast-1',
  // 'ap-southeast-2',
  // 'ap-southeast-3',
  // 'ap-southeast-4',
  // 'ap-southeast-5',
  // 'ap-southeast-7',
  // 'ca-west-1',
  // 'cn-north-1',
  // 'cn-northwest-1',
  // 'eu-central-1',
  // 'eu-central-2',
  // 'eu-north-1',
  // 'eu-south-1',
  // 'eu-south-2',
  // 'eu-west-1',
  // 'eu-west-2',
  // 'eu-west-3',
  // 'il-central-1',
  // 'me-central-1',
  // 'me-south-1',
  // 'mx-central-1',
  // 'sa-east-1',
  
  // Ignoring these for now...
  // 'us-gov-east-1',
  // 'us-gov-west-1',
  
] as const)[cl.map](region => {
  const [ c, z, num ] = region.split('-');
  const [ dir0, dir1 = dir0 ] = z.match(/central|north|south|east|west/g)!;
  return { term: region, mini: [ c, dir0[0], dir1[0], num ].join('') };
});