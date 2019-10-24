"use strict";
var _ = require('underscore');
_.mixin( require('toolbelt') );
var MongoClient = require('mongodb').MongoClient;
var pool = {};
var uuidV1 = require('uuid').v1;
var async = require('async');

var ConnectWrapper = function(auth, uri_template, collection_prefix) {
	this._arguments = _.toArray( arguments ).slice(0);
	auth = auth ? auth.split(' ') : '';   
	// create a buffer and tell it the data coming in is base64
    var plain_auth = new Buffer(auth[1], 'base64'); 
	
	if (uri_template) {

		// read it back out as a string
		plain_auth = plain_auth.toString().split(':');        	
		this.url = _.template(uri_template)({
			username: plain_auth[0],
			password: plain_auth[1]
		});
	
		// beware, this is undefined if not already "auth"
		this._db = pool[this.url];		

		// allow multiple logical databases within 1 physical;
		this._collection_prefix = collection_prefix ? collection_prefix + ':' : '';
		this._connection_id = uuidV1();
		this._dbName = _.last( this.url.split('/') )
	}
	this._options = {create: 10000, concurrency: 4, limit: 0};	
	return this;
};

ConnectWrapper.prototype.noPrefix = function() {
	return new ConnectWrapper( this._arguments[0], this._arguments[1] );
};

ConnectWrapper.prototype.auth = function(next) {
	var self = this;
	
	if (!pool[self.url]) {

		// initiate new connection
		MongoClient.connect( this.url, { 
			useUnifiedTopology: true,
			useNewUrlParser: true 
		}, function(err, client) {
			if (err) {
				return next(err);
			}
			pool[self.url] = self._db = client;
			setTimeout(function() { next(null, self); }, 50);
		});
	} else {
		self._db = pool[self.url];
		setTimeout(function() { next(null, self); }, 50);		
	}
	return this;
};

ConnectWrapper.prototype.db = function() {
	return this._db.db( this._dbName );
};

ConnectWrapper.prototype.close = function(callback) {
	this._db.close(callback);
};

ConnectWrapper.prototype.collection = function( collection ) {
	collection = this._collection_prefix + collection;
	return this.db().collection( collection );
};

ConnectWrapper.prototype.collectionName = function( collection ) {
	return this._collection_prefix + collection;
};

ConnectWrapper.prototype.collectionPrefix = function(prefix) {
	if (prefix) {
		this._collection_prefix = prefix;
	}
	return this._collection_prefix;
};

ConnectWrapper.prototype.create = function( collection, docs, next ) {
	var self = this;
	collection = this._collection_prefix + collection;
	docs = _.isArray(docs) ? docs : [docs];
	
	// We don't want to rely Mong's OID
	docs = docs.map(function(doc) {
		if ( !doc.hasOwnProperty('_id') ) {
			doc._id = uuidV1();
		} else if (typeof doc._id !== 'string') {
			doc._id = doc._id.toString();
		}
		return doc;
	});
	
	// copy docs 10000 at a time
	async.mapLimit(_.range(0, docs.length, this._options.create), 1, function(start, go) {
				
		self.db().collection( collection )
		.insertMany(docs.slice(start, start+self._options.create), {ordered: false}, function(err, response) {
			if (err) {
				console.log('[create] warning: error', (err && err.message) || err);
				return go(null, err);
			}
			go(null, response);
		});
	}, function(err, all) {
		console.log('[create] info: saved', collection, docs.length);
		next(err, _.flatten(all));
	});
};

ConnectWrapper.prototype.options = function(obj) {
	this._options = _.clean( obj );
	return this;
};

ConnectWrapper.prototype.createQueue = function( collection, update_only ) {
	let originalCollection = collection;
	let self = this;
	
	// make sure defaults are set.
	ConnectWrapper.prototype.options.call(self, _.defaults( self._options, {
		upsert:false, 
		create: 10000,
		concurrency: 4,
		limit: 0
	}));
	
	collection = this._collection_prefix + collection;
	let docs_to_save = [];
	let count = 0;
	let queue;
	let results = [];

	if (update_only) {
		queue = async.queue(function(doc, next) {

			if (!(count % 1000)) console.log('[createQueue] info: updating...', count);
			count += 1;

			return self.collection( originalCollection )
			.findOneAndUpdate({_id: doc._id}, {$set: doc['$set']}, _.pick(self._options, 'upsert'), function(err, result) {
				results.push(err && err.result || response && response.result || {});
				next();				
			});		
		}, self._options.concurrency);		
	} else {
		queue = async.queue(function(docs, next) {
			count += docs.length;
			return self.create( originalCollection, docs, function(err, response) {
				results.push(err && err.result || response && response.result || {});
				next();
			});
		}, 1);		
	}
	
	return {
		results: function() { return results.slice(0); },
		length: function() {
			return docs_to_save.length;
		},
		options: _.bind(ConnectWrapper.prototype.options, self),
		drain: function(fN) {
			queue.drain = function() {
				fN.call(self, null, { result: {ok:1, n:count}});
			};
			return this;
		},
		push: function(docs) {
			let to_save;
			
			docs = _.isArray(docs) ? docs : [ docs ];
			if (update_only) {
				
				return queue.push( docs.map(function(doc) {
					if (!doc.hasOwnProperty('$set')) {
						doc['$set'] = _.omit(doc, '_id');
					}
					return doc;
				}) );
			}
			
			docs_to_save = docs_to_save.concat( docs );
			if (docs_to_save.length >= self._options.create) {
				
				to_save = _.range(0, docs_to_save.length, self._options.create).map(function(start) {
					return docs_to_save.slice(start, start+self._options.create);
				});
				docs_to_save.length = 0;
				queue.push( to_save );
			}			
			return this;
		},
		flush: function(fN) {
			let self = this;
			
			if (_.isFunction(fN)) {
				self.drain(function() {
					fN.apply(self, arguments);
				});
			}
			queue.push( [docs_to_save.slice(0)] );
			return this;
		}
	};
};

ConnectWrapper.prototype.all_ids = function( collection, query, next ) {
	if (_.isFunction(query)) {
		next = query;
		query = {};
	}
	
	this.collection(collection)
	.find( query )
	.project({_id:1})
	.toArray(function(err, results) {
		next(err, !err ? _.getIds( results ) : null );
	});
};

ConnectWrapper.prototype.map = function( collection, query, fields, Fn, Final ) {
	let self = this;
	let cursor = this.collection( collection );
	
	if (typeof fields === 'function') {
		Final = Fn;
		Fn = fields;
		fields = {};
	}
	
	async.auto({
		count: function(next) { cursor.countDocuments(next); },
		find: ['count', function(next, data) {
			cursor.find( query ).project( fields ).limit( self._options.limit )
			.toArray(function(err, docs) {
				if (err) return next(err);
				next(null, docs.map(function(doc) {
					return Fn( doc );
				}));				
			});
		}],
		final: ['find', function(next, data) {
			Final( null, data.find );
		}],
	}, Final);
};

ConnectWrapper.prototype.filter = function( collection, query, fields, Fn, Final ) {
	let cursor = this.collection( collection );
	
	if (typeof fields === 'function') {
		Final = Fn;
		Fn = fields;
		fields = {};
	}
	
	this.map( collection, query, fields, _.identity, function(err, docs) {
		Final(err, docs.filter(Fn));
	});
};

ConnectWrapper.prototype.updateAll = function(collection, docs, callback) {
	this.createQueue( collection, true ).drain(callback).push( docs );
	return this;
};

ConnectWrapper.prototype.bulkSave = function(collection1, collection2, options, callback) {
	let self = this;
	
	if (_.isFunction(options)) {
		callback = options;
		options = {create: 10000, target: self};
		if (collection1 === collection2) {
			return callback({message: 'Cannot duplicate to identical collection name.'});
		}
	}
	options = _.defaults(options || {}, {create: 10000, target: self});
	let queue = options.target.createQueue( collection2 );
	
	self.all_ids( collection1, {}, function(err, ids) {
		if (err) {
			console.log('[bulkSave] error: ', err.message);
			return callback(err);
		}
		
		// copy docs 10000 at a time
		console.log('[bulkSave] info:', collection2, ids.length);
		async.eachLimit(_.range(0, ids.length, self._options.create), 1, function(start, next) {
			self.collection( collection1 )
			.find({_id:{$in: ids.slice(start, start+self._options.create)}})
			.toArray(function(err, docs) {	
				queue.push( docs );
				next();
			});
		}, function(err) {
			if (err) {
				console.log('[bulkSave] error:', err && err.message || err.reason || err);
				return callback(err);
			}
			queue.drain(callback).flush();
		});
	});
};

ConnectWrapper.prototype.findManyIn = function(collection, options, callback) {
	let self = this;
	
	async.mapLimit(_.range(0, options.select.length, 1000), 4, function(start, next) {
		self.collection( collection )
		.find({[options.key]: {$in: options.select.slice(start, start+1000)}})
		.toArray(next);
	}, function(err, docs) {
		callback(err, !err && _.flatten(docs));
	});
};

module.exports = function(auth, URI, prefix) {
	return new ConnectWrapper(auth, URI, prefix);
};
