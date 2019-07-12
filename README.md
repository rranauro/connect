# connect_wrapper
Connection management, workflow abstractions and collection name spacing.

## Why?
The [MongoDB](http://mongodb.github.io/node-mongodb-native/) driver provides a simple interface to MongoDB from Node, but we need an easy way to re-use connections to avoid out-of-memory conditions on the client. Also, we enhance the driver with `bulkSave` and `updateAll` methods to take advantage of MongoDB's inherent use of parallelism. Finally updating production servers with large reference databases can shut down a running application for for an extended period of time. The library provides a means of *name-spacing* a collection to allow re-writing a collection without over-writing the prior version. With new reference data, the application can be easily restarted to work with the new data.

## Installations
```
npm install https://github.com/rranauro/connect.git
```
Then in your code:
```
var connect = require('connect');
```

## API
### connect( auth, uri, prefix )
Creates a new connect object. 
- auth, a base64 encoded string.
- uri, a string path to your MongoDb database, for example: mongo://localhost:27017
- prefix, a string to prefix collections names therefore providing some namespace support.

If your MongoDb instance is secured `auth` is a security string based on your username and password:
```
var auth = "Basic " + new Buffer(env.username + ':' + env.password).toString('base64');
```
#### connect.auth(callback)
Creates and caches a connection to the running MongoDb server. Executes the callback with two arguments `err` and a handle to the `connect` object.

#### connect.db()
Returns a MongoDb database driver.

#### connect.collection(collectionName)
Returns a connection to MongoDb collection named `collectionName`. If a `prefix` was specified when creating the connect object, then the resulting collection in the MongoDb database will be prefixed.

```
var mydb = connect('auth', 'connect string', 'my_prefix');
mydb.collection('my_collection');
// => 'my_prefix:my_collection'
```

#### connect.collectionName(collectionName)
Returns the prefixed collection name from the current connect instance. In the example above, `my_prefix:my_collection`.

#### connect.collectionPrefix(prefix)
Changes the `prefix` for the connect object.

#### connect.create( collection, docs, callback )
Writes the array of `docs` to prefix:collection in 10,000 document chunks. 

#### connect.options(obj)
Configure `options` for this connect object. 
- create, an integer number of files to include in each chunk when writing. Default: 10,000
- upsert, a boolean flag for creating documents when updating that don't exist. Default: false
- concurrency, an integer number of concurrent MongoDb documents allowed when updating. Default: 4

#### connect.createQueue( collection [,update] )
Instantiate a queue connection for saving/updating large volumes of documents to collection. If `update` is `true` then documents are updated.
##### queue.push( docs )
Add a document or array of documents to the queue.

##### queue.options(obj)
Same as connect.options(obj).

##### queue.drain(callback)
Registers a callback to run whenever the queue is empty.

##### queue.flush()
Initiates final save/update after all jobs have been submitted to the queue.

#### connect.updateAll(collection, docs, callback)
Updates the entire list of `docs` being careful not to over-run the MongoDb server.

To allow more or less concurrency, update the `concurrency` option using the `connect.options` method.

#### connect.all_ids(collection, query, callback)
Finds all documents matched by the `query` and executes the `callback` with an array of document id's as the second argument.

#### connect.bulkSave(collection1, collection2, [options,] callback)
Copies *all* documents in `collection1` to `collection2` in an orderly and controlled fashion. 

The `options` object allows specification of a `target` connect object. This can be another database on the MongoDb server. In this case documents will be copied from one database to another and named according to the collection and prefix specification on their respective connect objects.

#### connect.filter(collection, query, [fields,] filterFn, callback)
Finds all documents matched by the `query` and gets all fields according to the optional `fields` object and applies `filterFn` to each. Documents that pass the `filterFn` predicate are passed to the final `callback`.
```
connect.filter('my_collection`, {}, {}, function(doc) {
  return doc.value === 'valid value';
}, function(err, docs) {
  console.log('Valid docs:', docs.length);
})
```






